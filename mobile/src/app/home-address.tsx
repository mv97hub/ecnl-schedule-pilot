import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";

import { Card, GoldButton, Hit, Loading, OutlineButton } from "@/components/ui";
import { ApiError, deleteHomeAddress, fetchAuthMe, putHomeAddress } from "@/lib/api";
import { useAccount } from "@/store/account";
import { colors } from "@/theme";
import type { AccountHomeAddress } from "@/lib/types";

const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"] as const;

type Draft = { street: string; unit: string; city: string; state: string; postalCode: string };
const EMPTY: Draft = { street: "", unit: "", city: "", state: "", postalCode: "" };

function fromAddress(address: AccountHomeAddress): Draft {
  return { street: address.street, unit: address.unit, city: address.city, state: address.state, postalCode: address.postal_code };
}

function formatAddress(address: AccountHomeAddress): string {
  const street = address.unit.trim() ? `${address.street}, ${address.unit}` : address.street;
  return `${street}, ${address.city}, ${address.state} ${address.postal_code}`;
}

export default function HomeAddressScreen() {
  const token = useAccount((state) => state.token);
  const [saved, setSaved] = useState<AccountHomeAddress | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!token) {
      setReady(true);
      return;
    }
    let active = true;
    fetchAuthMe(token)
      .then((me) => {
        if (!active) return;
        if (me.home_address) {
          setSaved(me.home_address);
          setDraft(fromAddress(me.home_address));
          setEditing(false);
        }
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setError("Could not load the home address.");
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function save() {
    if (!token) return;
    if (!draft.street.trim() || !draft.city.trim() || !draft.state || !draft.postalCode.trim()) {
      setError("Enter a street, city, state, and postal code.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const me = await putHomeAddress(token, {
        street: draft.street.trim(),
        unit: draft.unit.trim(),
        city: draft.city.trim(),
        state: draft.state,
        postal_code: draft.postalCode.trim(),
      });
      if (!me.home_address) return;
      setSaved(me.home_address);
      setDraft(fromAddress(me.home_address));
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the home address.");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      await deleteHomeAddress(token);
      setSaved(null);
      setDraft(EMPTY);
      setEditing(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not clear the home address.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Home address" }} />
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>
        <Text style={{ color: colors.secondary, lineHeight: 20 }}>The address stays on the account. It is not saved on this phone.</Text>
        {!token ? <Text style={{ color: colors.ink }}>Sign in to save a home address.</Text> : null}
        {token && !ready ? <Loading label="Loading address" /> : null}
        {token && ready && saved && !editing ? (
          <Card>
            <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 22 }}>{formatAddress(saved)}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <View style={{ flex: 1 }}><OutlineButton label="Change" onPress={() => setEditing(true)} /></View>
              <View style={{ flex: 1 }}><OutlineButton label="Clear" onPress={() => void clear()} /></View>
            </View>
          </Card>
        ) : null}
        {token && ready && editing ? (
          <View style={{ gap: 8 }}>
            <TextInput value={draft.street} onChangeText={(street) => setDraft((current) => ({ ...current, street }))} placeholder="Street" placeholderTextColor={colors.secondary} style={field} />
            <TextInput value={draft.unit} onChangeText={(unit) => setDraft((current) => ({ ...current, unit }))} placeholder="Unit" placeholderTextColor={colors.secondary} style={field} />
            <TextInput value={draft.city} onChangeText={(city) => setDraft((current) => ({ ...current, city }))} placeholder="City" placeholderTextColor={colors.secondary} style={field} />
            <OutlineButton label={draft.state ? draft.state : "State"} onPress={() => setPicking(true)} />
            <TextInput value={draft.postalCode} onChangeText={(postalCode) => setDraft((current) => ({ ...current, postalCode }))} placeholder="Postal code" placeholderTextColor={colors.secondary} autoCapitalize="characters" style={field} />
            <GoldButton label={saving ? "Saving" : "Save"} disabled={saving} onPress={() => void save()} />
          </View>
        ) : null}
        {error ? <Text style={{ color: colors.ink }}>{error}</Text> : null}
      </ScrollView>
      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 8 }}>
          <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800" }}>State</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {STATES.map((code) => (
              <Hit
                key={code}
                label={code}
                onPress={() => {
                  setDraft((current) => ({ ...current, state: code }));
                  setPicking(false);
                }}
                style={{ minWidth: 64, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center" }}
              >
                <Text style={{ color: colors.navy, fontWeight: "800" }}>{code}</Text>
              </Hit>
            ))}
          </View>
          <GoldButton label="Close" onPress={() => setPicking(false)} />
        </ScrollView>
      </Modal>
    </>
  );
}

const field = {
  minHeight: 44,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.line,
  backgroundColor: colors.white,
  paddingHorizontal: 12,
  color: colors.ink,
  fontSize: 16,
} as const;
