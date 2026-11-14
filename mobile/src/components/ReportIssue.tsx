import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, View } from "react-native";

import { GoldButton, OutlineButton, Segmented } from "@/components/ui";
import { ApiError, appVersion, submitIssueReport, type IssueCategory } from "@/lib/api";
import { colors } from "@/theme";

const DRAFT_KEY = "issue-report-draft";
const SENT_AT_KEY = "issue-report-sent-at";
const COOLDOWN_MS = 60_000;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Draft = {
  category: IssueCategory;
  description: string;
  email: string;
};

function screenName(pathname: string): string {
  if (pathname === "/favorites") return "Preferences";
  const name = pathname.replace(/^\//, "").trim();
  return name || "Preferences";
}

function isCategory(value: unknown): value is IssueCategory {
  return value === "data" || value === "app" || value === "other";
}

export function ReportIssue() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<IssueCategory>("app");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [draftRaw, sentRaw] = await Promise.all([AsyncStorage.getItem(DRAFT_KEY), AsyncStorage.getItem(SENT_AT_KEY)]);
        if (cancelled) return;
        if (draftRaw) {
          const draft = JSON.parse(draftRaw) as Partial<Draft>;
          if (isCategory(draft.category)) setCategory(draft.category);
          if (typeof draft.description === "string") setDescription(draft.description);
          if (typeof draft.email === "string") setEmail(draft.email);
        }
        const storedSent = Number(sentRaw);
        if (Number.isFinite(storedSent) && storedSent > 0) setSentAt(storedSent);
      } catch {
        // A missing draft still leaves the form usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const remainingMs = sentAt == null ? 0 : Math.max(0, sentAt + COOLDOWN_MS - now);
  const coolingDown = remainingMs > 0;

  async function persistDraft(draft: Draft): Promise<void> {
    try {
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // The fields stay on screen even if storage fails.
    }
  }

  function close(): void {
    setOpen(false);
    setError("");
    setSent(false);
  }

  async function send(): Promise<void> {
    const draft: Draft = { category, description, email };
    const text = description.trim();
    if (!text) {
      setError("Add a description.");
      await persistDraft(draft);
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Enter a valid email or leave it blank.");
      await persistDraft(draft);
      return;
    }
    if (coolingDown) {
      setError(`Wait ${Math.ceil(remainingMs / 1000)}s before sending another report.`);
      return;
    }
    setSending(true);
    setError("");
    try {
      await submitIssueReport({
        category,
        description: text,
        email: trimmedEmail,
        appVersion: appVersion(),
        screen: screenName(pathname),
      });
      const stamped = Date.now();
      setSentAt(stamped);
      setDescription("");
      setEmail("");
      setCategory("app");
      setSent(true);
      try {
        await AsyncStorage.removeItem(DRAFT_KEY);
        await AsyncStorage.setItem(SENT_AT_KEY, String(stamped));
      } catch {
        // The success state is already on screen.
      }
    } catch (caught) {
      await persistDraft(draft);
      const message = caught instanceof ApiError ? caught.message : "Could not send the report. Your draft is still here.";
      setError(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <View>
      <OutlineButton label="Report an Issue" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bone }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.navy, fontSize: 24, fontWeight: "800" }}>Report an Issue</Text>
            {sent ? (
              <View style={{ backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 8 }}>
                <Text style={{ color: colors.navy, fontSize: 20, fontWeight: "800" }}>Report sent</Text>
                <Text style={{ color: colors.ink, lineHeight: 22 }}>Thanks. We have your report.</Text>
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                <Text style={{ color: colors.secondary, lineHeight: 20 }}>No account needed. Tell us what went wrong.</Text>
                <Segmented
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: "data", label: "Data" },
                    { value: "app", label: "App" },
                    { value: "other", label: "Other" },
                  ]}
                />
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What happened?"
                  placeholderTextColor={colors.secondary}
                  multiline
                  textAlignVertical="top"
                  accessibilityLabel="Description"
                  style={{
                    minHeight: 140,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.line,
                    backgroundColor: colors.white,
                    padding: 12,
                    color: colors.ink,
                    fontSize: 16,
                  }}
                />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email (optional)"
                  placeholderTextColor={colors.secondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Email, optional"
                  style={{
                    minHeight: 44,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.line,
                    backgroundColor: colors.white,
                    paddingHorizontal: 12,
                    color: colors.ink,
                    fontSize: 16,
                  }}
                />
                {coolingDown ? (
                  <Text style={{ color: colors.secondary }}>You can send another report in {Math.ceil(remainingMs / 1000)}s.</Text>
                ) : null}
                {error ? <Text style={{ color: colors.loss, fontWeight: "700" }}>{error}</Text> : null}
                <GoldButton label={sending ? "Sending..." : "Send report"} onPress={() => void send()} disabled={sending || coolingDown} />
              </View>
            )}
            <OutlineButton label="Close" onPress={close} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
