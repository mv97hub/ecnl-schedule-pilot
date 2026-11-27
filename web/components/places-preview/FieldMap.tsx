"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";

import "leaflet/dist/leaflet.css";

export type MapPin = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  kind: "field" | "stay" | "eat" | "do" | "tip" | "draft";
};

const COLOR: Record<MapPin["kind"], string> = {
  field: "#14284B",
  stay: "#C4A35A",
  eat: "#3F6F54",
  do: "#3D5A80",
  tip: "#78716C",
  draft: "#B45309",
};

export function FieldMap({
  pins,
  focusId,
  className = "h-80",
}: {
  pins: MapPin[];
  focusId?: string;
  className?: string;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    let cancelled = false;
    let map: LeafletMap | null = null;
    void import("leaflet").then((leaflet) => {
      if (cancelled) return;
      const L = leaflet.default;
      map = L.map(node, { scrollWheelZoom: false }).setView([39.8, -98.5], 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !map || !layer) return;
    void import("leaflet").then((leaflet) => {
      const L = leaflet.default;
      layer.clearLayers();
      for (const pin of pins) {
        const color = COLOR[pin.kind];
        const marker = L.marker([pin.latitude, pin.longitude], {
          icon: L.divIcon({
            className: "",
            html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px ${color}"></span>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
          zIndexOffset: pin.kind === "draft" || pin.kind === "field" ? 500 : 0,
        });
        marker.bindTooltip(pin.label, { direction: "top" });
        marker.addTo(layer);
      }
      const focus = pins.find((pin) => pin.id === focusId);
      if (focus) {
        map.setView([focus.latitude, focus.longitude], 13);
      } else if (pins.length === 1) {
        map.setView([pins[0].latitude, pins[0].longitude], 13);
      } else if (pins.length > 1) {
        map.fitBounds(
          pins.map((pin) => [pin.latitude, pin.longitude] as [number, number]),
          { padding: [28, 28], maxZoom: 13 },
        );
      }
      map.invalidateSize();
    });
  }, [pins, focusId, ready]);

  return (
    <div className={`places-map relative z-0 overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 ${className} [&_.leaflet-bottom]:!z-[2] [&_.leaflet-pane]:!z-[1] [&_.leaflet-top]:!z-[2]`}>
      <div ref={nodeRef} className="h-full w-full" />
    </div>
  );
}
