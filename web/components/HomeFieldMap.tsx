"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";

import "leaflet/dist/leaflet.css";

export type HomePin = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  number: number;
};

export function HomeFieldMap({
  pins,
  focusId,
  onSelect,
  className = "h-80",
}: {
  pins: HomePin[];
  focusId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const selectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  selectRef.current = onSelect;

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
        const selected = pin.id === focusId;
        const color = selected ? "#f2b705" : "#14284b";
        const ink = selected ? "#14284b" : "#fff";
        const marker = L.marker([pin.latitude, pin.longitude], {
          icon: L.divIcon({
            className: "",
            html: `<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;background:${color};color:${ink};border:2px solid #fff;box-shadow:0 0 0 1px ${color};font-size:11px;font-weight:700">${pin.number}</span>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
          zIndexOffset: selected ? 800 : 400,
        });
        marker.bindTooltip(pin.label, { direction: "top" });
        marker.on("click", () => selectRef.current?.(pin.id));
        marker.addTo(layer);
      }
      const focus = pins.find((pin) => pin.id === focusId);
      if (focus) {
        map.setView([focus.latitude, focus.longitude], Math.max(map.getZoom(), 11));
      } else if (pins.length === 1) {
        map.setView([pins[0].latitude, pins[0].longitude], 12);
      } else if (pins.length > 1) {
        map.fitBounds(
          pins.map((pin) => [pin.latitude, pin.longitude] as [number, number]),
          { padding: [28, 28], maxZoom: 12 },
        );
      } else {
        map.setView([39.8, -98.5], 4);
      }
      map.invalidateSize();
    });
  }, [pins, focusId, ready]);

  return (
    <div className={`relative z-0 overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 ${className} [&_.leaflet-bottom]:!z-[2] [&_.leaflet-pane]:!z-[1] [&_.leaflet-top]:!z-[2]`}>
      <div ref={nodeRef} className="h-full w-full" />
    </div>
  );
}
