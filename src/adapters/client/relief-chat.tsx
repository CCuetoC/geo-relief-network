"use client";

import { useEffect, useRef, useState } from "react";
import { authClient } from "@/adapters/client/neon-auth";
import type { ConversationActionOption, ConversationOutput } from "@/domain/types";
import { useI18n } from "@/adapters/client/i18n-provider";
import { formatNumber } from "@/i18n/locale";
import { notificationMessage } from "@/i18n/messages";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  output?: ConversationOutput;
  noticeId?: string;
}

export function ReliefChat() {
  const { locale, t } = useI18n();
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | undefined>();
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<ConversationActionOption | null>(null);
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [whatsappLinked, setWhatsappLinked] = useState(false);
  const [whatsappLink, setWhatsappLink] = useState("");
  const seenNotices = useRef(new Set<string>());

  useEffect(() => {
    const storedConversationId = window.sessionStorage.getItem("grn-conversation-id");
    const nextConversationId = storedConversationId || crypto.randomUUID();
    window.sessionStorage.setItem("grn-conversation-id", nextConversationId);
    setConversationId(nextConversationId);
    const syncSession = () => {
      void authClient.getSession().then(({ data }) => setSignedIn(Boolean(data?.user))).catch(() => setSignedIn(false));
    };
    syncSession();
    window.addEventListener("focus", syncSession);
    return () => window.removeEventListener("focus", syncSession);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/notifications");
        if (!response.ok) return;
        const body = await response.json() as { notifications?: Array<{ id: string; event_type: string; payload?: Record<string, unknown> }> };
        const notifications = (body.notifications ?? []).filter((item) => !seenNotices.current.has(item.id));
        if (!notifications.length || !active) return;
        notifications.forEach((item) => seenNotices.current.add(item.id));
        setMessages((current) => [...current, ...notifications.map((item) => ({
          role: "assistant" as const,
          text: item.payload?.text && item.event_type !== "FIFO_OFFER_CREATED" && item.event_type !== "PHYSICAL_PICKUP_CONFIRMED"
            ? String(item.payload.text)
            : notificationMessage(locale, item.event_type, item.payload ?? {}),
          noticeId: item.id,
        }))]);
        await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: notifications.map((item) => item.id) }),
        });
      } catch { /* Notifications remain available on the next poll. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 45_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [locale, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/whatsapp/link");
        if (!response.ok) return;
        const result = await response.json() as { linked?: boolean };
        if (active) setWhatsappLinked(Boolean(result.linked));
      } catch { /* The next refresh will retry. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [signedIn]);

  async function createWhatsAppLink() {
    setNotice("");
    try {
      const response = await fetch("/api/whatsapp/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: whatsappConsent, locale }),
      });
      const result = await response.json() as { url?: string; message?: string };
      if (!response.ok || !result.url) throw new Error(t("chat.linkError"));
      setWhatsappLink(result.url);
      setNotice(t("chat.linkCreated"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("chat.linkError"));
    }
  }

  async function unlinkWhatsApp() {
    try {
      const response = await fetch("/api/whatsapp/link", { method: "DELETE" });
      if (!response.ok) throw new Error(t("chat.unlinkError"));
      setWhatsappLinked(false);
      setWhatsappLink("");
      setWhatsappConsent(false);
      setNotice(t("chat.unlinked"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("chat.unlinkError"));
    }
  }

  async function shareLocation() {
    if (!navigator.geolocation) return setNotice(t("map.noLocation"));
    setNotice(t("map.locationRequest"));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setNotice(t("map.locationReady"));
      },
      () => setNotice(t("map.locationDenied")),
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 },
    );
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    if (!signedIn) return setNotice(t("chat.signInForPhotos"));
    setBusy(true);
    setNotice("");
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files).slice(0, 10)) {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch("/api/media/upload", { method: "POST", body: form });
        const result = await response.json() as { id?: string; message?: string };
        if (!response.ok || !result.id) throw new Error(t("chat.photoUploadError"));
        uploaded.push(result.id);
      }
      setPhotoIds((current) => [...new Set([...current, ...uploaded])]);
      setNotice(t("chat.photosUploaded", { count: formatNumber(locale, uploaded.length) }));
    } catch (error) {
      setNotice(t("chat.photoUploadError"));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(message: string, confirmationDraftId?: string, audio?: File) {
    if (!conversationId || busy || (!message.trim() && !confirmationDraftId && !audio)) return;
    setBusy(true);
    setNotice("");
    if (message.trim() && !confirmationDraftId) setMessages((current) => [...current, { role: "user", text: message }]);
    try {
      let response: Response;
      if (audio) {
        const form = new FormData();
        form.set("conversationId", conversationId);
        form.set("locale", locale);
        form.set("audio", audio);
        form.set("text", message);
        form.set("photoMediaIds", JSON.stringify(photoIds));
        if (location) form.set("location", JSON.stringify(location));
        response = await fetch("/api/chat", { method: "POST", body: form });
      } else {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, locale, text: message, photoMediaIds: photoIds, location, confirmationDraftId }),
        });
      }
      const output = await response.json() as ConversationOutput & { message?: string };
      if (!response.ok && !output.text) throw new Error(t("api.chatError"));
      setMessages((current) => [...current, { role: "assistant", text: output.text, output }]);
      if (output.phase === "COMPLETED") setPhotoIds([]);
      setText("");
    } catch (error) {
      setNotice(t("chat.sendError"));
    } finally {
      setBusy(false);
    }
  }

  function confirm(option: ConversationActionOption) {
    setPendingConfirmation(option);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{t("brand.short")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t("chat.title")}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("chat.intro")}</p>
        </div>
      </header>

      <section aria-label={t("chat.conversation")} className="flex min-h-[45vh] flex-col gap-3 rounded-2xl border bg-card p-3 sm:p-5">
        {messages.length === 0 ? <div className="my-auto space-y-2 py-10 text-center text-sm text-muted-foreground">
          <p>{t("chat.examples")}</p><p>{t("chat.exampleRequest")}</p><p>{t("chat.exampleDonation")}</p>
        </div> : messages.map((message, index) => <article key={String(index) + "-" + message.role} className={"max-w-[92%] rounded-xl px-4 py-3 text-sm " + (message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-muted")}>
          <p className="whitespace-pre-wrap">{message.text}</p>
          {message.output?.recommendation && <div className="mt-3 rounded-lg border bg-card p-3 text-card-foreground">
            <p className="font-semibold">{message.output.recommendation.name}</p>
            <p>{message.output.recommendation.neighborhood}{message.output.recommendation.distanceKm === null ? "" : " · " + t("map.distance", { distance: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(message.output.recommendation.distanceKm) })}</p>
            <ul className="mt-2 list-disc pl-5 text-xs">{message.output.recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>}
          {message.output?.actionOptions?.map((option) => <button key={option.draftId} disabled={busy} onClick={() => confirm(option)} className="mt-3 block w-full rounded-lg bg-primary px-3 py-2 text-left font-medium text-primary-foreground disabled:opacity-50">
            <span className="block">{option.label}</span><span className="mt-1 block text-xs font-normal opacity-90">{option.summary}</span>
          </button>)}
        </article>)}
        {busy && <p className="mr-auto rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{t("chat.processing")}</p>}
      </section>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <label className="cursor-pointer rounded-lg border px-3 py-2 hover:bg-muted">
          {t("chat.attachPhotos", { count: formatNumber(locale, photoIds.length) })}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => { void uploadPhotos(event.target.files); event.currentTarget.value = ""; }} />
        </label>
        <label className="cursor-pointer rounded-lg border px-3 py-2 hover:bg-muted">
          {t("chat.sendAudio")}
          <input type="file" accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp3,.wav,.mp3" className="sr-only" onChange={(event) => { const audio = event.target.files?.[0]; if (audio) void sendMessage("", undefined, audio); event.currentTarget.value = ""; }} />
        </label>
        <button onClick={() => void shareLocation()} className="rounded-lg border px-3 py-2 hover:bg-muted">{t("chat.sharePin")}</button>
        {photoIds.length > 0 && <button onClick={() => setPhotoIds([])} className="rounded-lg px-2 py-2 underline">{t("chat.removePhotos")}</button>}
      </div>

      {signedIn && <section className="rounded-xl border bg-card p-4 text-sm">
        <h2 className="font-medium">{t("chat.linkWhatsApp")}</h2>
        {whatsappLinked ? <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><p className="text-muted-foreground">{t("chat.linkedNumber")}</p><button type="button" onClick={() => void unlinkWhatsApp()} className="rounded-lg border px-3 py-2">{t("chat.unlink")}</button></div> : <>
        <label className="mt-2 flex items-start gap-2 text-muted-foreground">
          <input type="checkbox" checked={whatsappConsent} onChange={(event) => setWhatsappConsent(event.target.checked)} />
          <span>{t("chat.whatsAppConsent")}</span>
        </label>
        <button type="button" disabled={!whatsappConsent} onClick={() => void createWhatsAppLink()} className="mt-3 rounded-lg border px-3 py-2 disabled:opacity-50">{t("chat.createLink")}</button>
        {whatsappLink && <a className="ml-3 underline underline-offset-4" href={whatsappLink} target="_blank" rel="noreferrer">{t("chat.openWhatsApp")}</a>}
        </>}
      </section>}

      <form onSubmit={(event) => { event.preventDefault(); void sendMessage(text); }} className="flex gap-2">
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t("chat.messagePlaceholder")} rows={2} maxLength={6000} className="min-h-12 flex-1 resize-y rounded-xl border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
        <button disabled={busy || !text.trim()} className="self-end rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{t("chat.send")}</button>
      </form>
      {pendingConfirmation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onKeyDown={(event) => { if (event.key === "Escape") setPendingConfirmation(null); }}>
        <section role="alertdialog" aria-modal="true" aria-labelledby="action-confirmation-title" aria-describedby="action-confirmation-summary" className="w-full max-w-lg space-y-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-xl">
          <div>
            <h2 id="action-confirmation-title" className="text-lg font-semibold">{t("chat.confirmTitle")}</h2>
            <p id="action-confirmation-summary" className="mt-2 text-sm">{pendingConfirmation.summary}</p>
            <p className="mt-3 text-xs text-muted-foreground">{t("chat.confirmDescription")}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => setPendingConfirmation(null)} className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50">{t("chat.cancel")}</button>
            <button type="button" disabled={busy} onClick={() => {
              const option = pendingConfirmation;
              setPendingConfirmation(null);
              void sendMessage("", option.draftId);
            }} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{t("chat.confirmAction")}</button>
          </div>
        </section>
      </div>}
      <p aria-live="polite" className="min-h-5 text-xs text-muted-foreground">{notice}</p>
      <p className="text-xs text-muted-foreground">{t("chat.privacy")}</p>
    </main>
  );
}
