"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Role = "user" | "bot" | "typing" | "error";
type Message = { role: Role; text: string; time?: string; audio?: string | null };

function formatTime(): string {
  return new Date().toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" });
}

function playAudio(base64: string) {
  const audio = new Audio(`data:audio/ogg;base64,${base64}`);
  audio.play().catch((e) => console.error("no se pudo reproducir el audio:", e));
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "bot", text: "Hola, soy Robin. Contame qué necesitás." },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voice, setVoice] = useState({ stt: false, tts: false });
  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Auto-resize del textarea (crece con el contenido hasta max-h-36).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    fetch("/api/voice-status")
      .then((r) => r.json())
      .then(setVoice)
      .catch(() => {});
  }, []);

  function scrollLog() {
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setMessages((m) => [...m, { role: "user", text, time: formatTime() }]);
    setDraft("");
    setSending(true);
    scrollLog();
    setMessages((m) => [...m, { role: "typing", text: "escribiendo..." }]);
    scrollLog();

    try {
      const res = await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m.slice(0, -1), // saca "typing"
        { role: res.ok ? "bot" : "error", text: res.ok ? data.reply : data.error || "Error", time: formatTime() },
      ]);
    } catch {
      setMessages((m) => [...m.slice(0, -1), { role: "error", text: "No pude conectar con el servidor." }]);
    } finally {
      setSending(false);
      scrollLog();
    }
  }

  async function sendVoice(blob: Blob) {
    setRecording(false);
    setSending(true);
    setMessages((m) => [...m, { role: "typing", text: "transcribiendo..." }]);
    scrollLog();

    try {
      const res = await fetch("/api/voice-message", {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m.slice(0, -1), { role: "error", text: data.error || "Error" }]);
      } else {
        const time = formatTime();
        setMessages((m) => {
          const withoutTyping = m.slice(0, -1);
          const added: Message[] = [];
          if (data.transcript) added.push({ role: "user", text: `🎙️ "${data.transcript}"`, time });
          added.push({ role: "bot", text: data.reply, audio: data.audio || null, time });
          return [...withoutTyping, ...added];
        });
        if (data.audio) playAudio(data.audio);
      }
    } catch {
      setMessages((m) => [...m.slice(0, -1), { role: "error", text: "No pude mandar el audio." }]);
    } finally {
      setSending(false);
      scrollLog();
    }
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop(); // el resto sigue en onstop, ver abajo
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        sendVoice(blob);
      };
      mediaRecorder.start();
      setRecording(true);
    } catch (e) {
      console.error(e);
      setMessages((m) => [...m, { role: "error", text: "No pude acceder al micrófono (¿le diste permiso al navegador?)." }]);
      scrollLog();
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div ref={logRef} className="flex-1 overflow-y-auto px-3 sm:px-5 py-5 flex flex-col gap-2.5 max-w-3xl w-full mx-auto">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[82%] sm:max-w-[80%] px-3.5 py-2.5 rounded-[18px] text-[15px] leading-relaxed whitespace-pre-wrap break-words shadow-sm",
                m.role === "user" && "bg-accent text-accent-foreground rounded-br-[4px]",
                m.role === "bot" && "bg-panel2 border border-border rounded-bl-[4px]",
                m.role === "typing" && "text-muted italic bg-transparent px-1",
                m.role === "error" && "border border-red-900 text-red-300",
              )}
            >
              <span>{m.text}</span>
              {m.audio && (
                <button
                  onClick={() => playAudio(m.audio!)}
                  className="block mt-1.5 text-xs opacity-80 hover:opacity-100 hover:underline"
                >
                  ▶ escuchar
                </button>
              )}
            </div>
            {m.time && <span className="text-[10.5px] text-muted mt-1 px-1">{m.time}</span>}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="px-3 sm:px-5 pt-2 pb-[calc(0.625rem+env(safe-area-inset-bottom))] flex items-end gap-2 max-w-3xl w-full mx-auto shrink-0"
      >
        <div className="flex-1 flex items-end gap-1 bg-panel border border-border rounded-3xl pl-4 pr-1.5 py-1.5 focus-within:border-accent">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Mensaje"
            className="py-1.5 max-h-36"
          />
          {voice.stt && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={toggleRecording}
              className={cn("rounded-full", recording && "bg-red-500 text-white animate-pulse hover:bg-red-500")}
              title={recording ? "Grabando... click para mandar" : "Grabar nota de voz"}
            >
              <Mic size={18} />
            </Button>
          )}
        </div>
        <Button type="submit" size="icon" className="rounded-full h-11 w-11" disabled={sending || !draft.trim()}>
          <Send size={18} className="translate-x-[1px]" />
        </Button>
      </form>
    </div>
  );
}
