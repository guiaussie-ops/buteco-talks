import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RemotePeer = {
  userId: string;
  stream: MediaStream;
  hasVideo: boolean;
};

type SignalPayload = {
  from: string;
  to: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

type PeerBox = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  videoSender: RTCRtpSender | null;
};

/**
 * WebRTC mesh room. Signaling rides on a Realtime broadcast channel.
 * Presence tells us who is in the room.
 */
export function useVoiceRoom(channelId: string | null, userId: string | null) {
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [micStream, setMicStreamState] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [videoMode, setVideoMode] = useState<"none" | "camera" | "screen">("none");
  const [error, setError] = useState<string | null>(null);

  const chanRef = useRef<RealtimeChannel | null>(null);
  const peersRef = useRef<Map<string, PeerBox>>(new Map());
  const micStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  const publish = useCallback(() => {
    setRemotePeers(
      Array.from(remoteStreamsRef.current.entries()).map(([id, stream]) => ({
        userId: id,
        stream,
        hasVideo: stream.getVideoTracks().some((t) => t.readyState === "live"),
      })),
    );
  }, []);

  const send = useCallback((payload: SignalPayload) => {
    void chanRef.current?.send({ type: "broadcast", event: "signal", payload });
  }, []);

  const createPeer = useCallback(
    (remoteId: string, polite: boolean) => {
      const existing = peersRef.current.get(remoteId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      const box: PeerBox = { pc, polite, makingOffer: false, ignoreOffer: false, videoSender: null };
      peersRef.current.set(remoteId, box);

      micStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, micStreamRef.current!));
      const vTrack = videoStreamRef.current?.getVideoTracks()[0];
      if (vTrack && videoStreamRef.current) {
        box.videoSender = pc.addTrack(vTrack, videoStreamRef.current);
      }

      pc.onicecandidate = (e) => {
        if (e.candidate && userId) send({ from: userId, to: remoteId, candidate: e.candidate.toJSON() });
      };

      pc.onnegotiationneeded = async () => {
        if (!userId) return;
        try {
          box.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) send({ from: userId, to: remoteId, description: pc.localDescription.toJSON() });
        } catch {
          /* ignore */
        } finally {
          box.makingOffer = false;
        }
      };

      pc.ontrack = (e) => {
        let stream = remoteStreamsRef.current.get(remoteId);
        if (!stream) {
          stream = new MediaStream();
          remoteStreamsRef.current.set(remoteId, stream);
        }
        if (!stream.getTracks().some((t) => t.id === e.track.id)) stream.addTrack(e.track);
        e.track.onended = () => {
          stream?.removeTrack(e.track);
          publish();
        };
        e.track.onmute = publish;
        e.track.onunmute = publish;
        publish();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          pc.close();
          peersRef.current.delete(remoteId);
          remoteStreamsRef.current.delete(remoteId);
          publish();
        }
      };

      return box;
    },
    [publish, send, userId],
  );

  const dropPeer = useCallback(
    (remoteId: string) => {
      peersRef.current.get(remoteId)?.pc.close();
      peersRef.current.delete(remoteId);
      remoteStreamsRef.current.delete(remoteId);
      publish();
    },
    [publish],
  );

  // ---- join / leave -------------------------------------------------------
  useEffect(() => {
    if (!channelId || !userId) return;
    let cancelled = false;

    const start = async () => {
      try {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        setError("Não consegui acessar o microfone. Você entrou apenas como ouvinte.");
          micStreamRef.current = null;
        }
      setMicStreamState(micStreamRef.current);
      if (cancelled) return;

      const chan = supabase.channel(`voice:${channelId}`, {
        config: { presence: { key: userId }, broadcast: { self: false } },
      });
      chanRef.current = chan;

      chan.on("presence", { event: "sync" }, () => {
        const state = chan.presenceState();
        const ids = Object.keys(state).filter((id) => id !== userId);
        ids.forEach((id) => {
          if (!peersRef.current.has(id)) {
            // deterministic roles: lower id is the impolite initiator
            const initiator = userId < id;
            const box = createPeer(id, !initiator);
            if (initiator) void box.pc.createOffer().then(() => undefined);
          }
        });
        Array.from(peersRef.current.keys()).forEach((id) => {
          if (!ids.includes(id)) dropPeer(id);
        });
      });

      chan.on("broadcast", { event: "signal" }, async ({ payload }) => {
        const msg = payload as SignalPayload;
        if (msg.to !== userId) return;
        const box = peersRef.current.get(msg.from) ?? createPeer(msg.from, userId > msg.from);
        const { pc } = box;
        try {
          if (msg.description) {
            const offerCollision =
              msg.description.type === "offer" && (box.makingOffer || pc.signalingState !== "stable");
            box.ignoreOffer = !box.polite && offerCollision;
            if (box.ignoreOffer) return;
            await pc.setRemoteDescription(msg.description);
            if (msg.description.type === "offer") {
              await pc.setLocalDescription();
              if (pc.localDescription) {
                send({ from: userId, to: msg.from, description: pc.localDescription.toJSON() });
              }
            }
          } else if (msg.candidate) {
            try {
              await pc.addIceCandidate(msg.candidate);
            } catch {
              if (!box.ignoreOffer) throw new Error("ice");
            }
          }
        } catch {
          /* ignore transient signaling errors */
        }
      });

      chan.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await chan.track({ userId, at: Date.now() });
          setConnected(true);
        }
      });
    };

    void start();

    return () => {
      cancelled = true;
      setConnected(false);
      setMicOn(true);
      peersRef.current.forEach((b) => b.pc.close());
      peersRef.current.clear();
      remoteStreamsRef.current.clear();
      setRemotePeers([]);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setMicStreamState(null);
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
      setLocalVideoStream(null);
      setVideoMode("none");
      if (chanRef.current) void supabase.removeChannel(chanRef.current);
      chanRef.current = null;
    };
  }, [channelId, userId, createPeer, dropPeer, send]);

  // ---- controls -----------------------------------------------------------
  const toggleMic = useCallback(() => {
    const tracks = micStreamRef.current?.getAudioTracks() ?? [];
    const next = !micOn;
    tracks.forEach((t) => (t.enabled = next));
    setMicOn(next);
  }, [micOn]);

  const stopVideo = useCallback(() => {
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    videoStreamRef.current = null;
    setLocalVideoStream(null);
    setVideoMode("none");
    peersRef.current.forEach((box) => {
      if (box.videoSender) {
        try {
          box.pc.removeTrack(box.videoSender);
        } catch {
          /* ignore */
        }
        box.videoSender = null;
      }
    });
  }, []);

  const startVideo = useCallback(
    async (mode: "camera" | "screen") => {
      setError(null);
      try {
        const stream =
          mode === "screen"
            ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
            : await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });

        videoStreamRef.current?.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = stream;
        setLocalVideoStream(stream);
        setVideoMode(mode);

        const track = stream.getVideoTracks()[0];
        if (track) {
          track.onended = () => stopVideo();
          peersRef.current.forEach((box) => {
            if (box.videoSender) box.videoSender.replaceTrack(track);
            else box.videoSender = box.pc.addTrack(track, stream);
          });
        }
      } catch {
        setError(
          mode === "screen"
            ? "Compartilhamento de tela cancelado ou bloqueado pelo navegador."
            : "Não consegui acessar a câmera.",
        );
      }
    },
    [stopVideo],
  );

  return {
    connected,
    micOn,
    micStream,
    toggleMic,
    remotePeers,
    localVideoStream,
    videoMode,
    startVideo,
    stopVideo,
    error,
    participantCount: remotePeers.length + 1,
  };
}
