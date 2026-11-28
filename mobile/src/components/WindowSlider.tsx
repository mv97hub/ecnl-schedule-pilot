import { useRef, useState } from "react";
import { PanResponder, Text, View } from "react-native";

import { dayLabel } from "@/lib/weekend";
import { colors } from "@/theme";

export function WindowSlider({
  days,
  start,
  end,
  onStart,
  onEnd,
}: {
  days: string[];
  start: string;
  end: string;
  onStart: (day: string) => void;
  onEnd: (day: string) => void;
}) {
  const max = Math.max(days.length - 1, 0);
  const startIndex = Math.max(0, days.indexOf(start));
  const endIndex = Math.max(startIndex, days.indexOf(end));
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const startRef = useRef(startIndex);
  const endRef = useRef(endIndex);
  const daysRef = useRef(days);
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);
  const startGrant = useRef(startIndex);
  const endGrant = useRef(endIndex);
  startRef.current = startIndex;
  endRef.current = endIndex;
  daysRef.current = days;
  onStartRef.current = onStart;
  onEndRef.current = onEnd;
  const pad = 22;
  const left = max === 0 || width === 0 ? pad : pad + (startIndex / max) * (width - pad * 2);
  const right = max === 0 || width === 0 ? width - pad : pad + (endIndex / max) * (width - pad * 2);

  function dayAt(index: number): string | undefined {
    return daysRef.current[index];
  }

  function indexFromDrag(grant: number, dx: number): number {
    const inner = Math.max(widthRef.current - pad * 2, 1);
    const span = Math.max(daysRef.current.length - 1, 0);
    return grant + Math.round((dx / inner) * span);
  }

  const startPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startGrant.current = startRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const next = Math.min(Math.max(indexFromDrag(startGrant.current, gesture.dx), 0), endRef.current);
        const day = dayAt(next);
        if (day) onStartRef.current(day);
      },
    }),
  ).current;
  const endPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        endGrant.current = endRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const span = Math.max(daysRef.current.length - 1, 0);
        const next = Math.max(Math.min(indexFromDrag(endGrant.current, gesture.dx), span), startRef.current);
        const day = dayAt(next);
        if (day) onEndRef.current(day);
      },
    }),
  ).current;

  return (
    <View accessibilityLabel={`Window ${start} through ${end}`}>
      <Text style={{ color: colors.navy, fontWeight: "700" }}>
        {start ? dayLabel(start) : ""} – {end ? dayLabel(end) : ""}
      </Text>
      <View
        style={{ height: 44, marginTop: 8, justifyContent: "center" }}
        onLayout={(event) => {
          widthRef.current = event.nativeEvent.layout.width;
          setWidth(event.nativeEvent.layout.width);
        }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.line, marginHorizontal: pad }} />
        {width > 0 ? (
          <View
            style={{
              position: "absolute",
              left,
              width: Math.max(right - left, 4),
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.navy,
            }}
          />
        ) : null}
        <View
          accessibilityLabel="Window start"
          accessibilityRole="adjustable"
          {...startPan.panHandlers}
          style={{ position: "absolute", left: left - 22, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navy }}
        />
        <View
          accessibilityLabel="Window finish"
          accessibilityRole="adjustable"
          {...endPan.panHandlers}
          style={{ position: "absolute", left: right - 22, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.navy }}
        />
      </View>
    </View>
  );
}
