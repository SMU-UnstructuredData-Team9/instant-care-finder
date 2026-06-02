import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  Phone,
  Navigation,
  AlertTriangle,
  ChevronRight,
  Search,
  LocateFixed,
  Pencil,
  Check,
} from "lucide-react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ER-Navi · 실시간 응급실 수용 가능 병원 추천" },
      {
        name: "description",
        content:
          "현재 위치 기준 실시간 병상 현황과 중증질환 수용 가능 여부를 종합해 지금 갈 수 있는 응급실을 추천합니다.",
      },
      { property: "og:title", content: "ER-Navi · 실시간 응급실 추천" },
      {
        property: "og:description",
        content: "지금 실제로 갈 수 있는 응급실을 추천합니다.",
      },
    ],
  }),
  component: Index,
});

// 증상 카테고리 (체크/검색 양쪽으로 추리기)
// 한 증상이 여러 진료군과 동시에 매칭되도록 키워드를 의도적으로 넓게 겹침.
// 응급 상황에서는 정확한 병명 판단보다 "가능성 있는 모든 진료군"을 띄워주는 것이 안전함.
// 예: "복통" → 일반응급 + 응급수술 (장염일 수도, 맹장일 수도)
//     "두통" → 일반응급 + 뇌출혈 + 뇌졸중 + 중독
const SYMPTOMS = [
  {
    id: "심근경색",
    label: "가슴통증 · 심근경색",
    keywords: ["가슴", "심장", "흉통", "답답", "조이", "호흡곤란", "숨", "심근경색"],
  },
  {
    id: "뇌졸중",
    label: "마비 · 뇌졸중",
    keywords: ["마비", "어지러", "발음", "한쪽", "쓰러", "두통", "머리", "어눌", "뇌졸중"],
  },
  {
    id: "뇌출혈",
    label: "두통 · 뇌출혈",
    keywords: ["두통", "머리", "구토", "의식", "쓰러", "터질", "뇌출혈"],
  },
  {
    id: "중증외상",
    label: "교통사고 · 중증외상",
    keywords: ["사고", "외상", "출혈", "골절", "추락", "충돌", "찢어", "부딪", "다침"],
  },
  {
    id: "일반응급",
    label: "복통 · 발열 · 일반 응급",
    keywords: ["복통", "배", "설사", "구토", "발열", "열", "장염", "메스꺼움", "어지러", "두통"],
  },
  {
    id: "응급수술",
    label: "응급수술 가능성 (맹장 · 장폐색 등)",
    // 복통도 포함 — 일반인이 맹장인지 장염인지 구분 불가하므로 가능성으로 띄움
    keywords: ["복통", "배", "수술", "맹장", "충수염", "장폐색", "내장", "심한", "출혈"],
  },
  {
    id: "소아응급",
    label: "소아 · 영유아 응급",
    keywords: ["아이", "소아", "영아", "아기", "신생아", "경련"],
  },
  { id: "화상", label: "화상", keywords: ["화상", "데임", "끓", "뜨거"] },
  {
    id: "중독",
    label: "중독 · 약물",
    keywords: ["중독", "약물", "음독", "가스", "두통", "구토", "어지러"],
  },
] as const;

type SymptomId = (typeof SYMPTOMS)[number]["id"];
type Status = "available" | "caution" | "saturated";

interface Hospital {
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  etaMin: number;
  score: number;
  status: Status;
  er: { value: number; total: number };
  icu: { value: number; total: number };
  or: { value: number; total: number };
  capabilities: SymptomId[];
  message?: string;
}

const HOSPITALS: Hospital[] = [
  {
    name: "서울성심중앙병원",
    address: "강남구 삼성로",
    lat: 37.5108,
    lng: 127.0594,
    distanceKm: 1.2,
    etaMin: 6,
    score: 98,
    status: "available",
    er: { value: 12, total: 45 },
    icu: { value: 4, total: 12 },
    or: { value: 2, total: 8 },
    capabilities: ["일반응급", "심근경색", "응급수술", "뇌출혈", "중증외상"],
  },
  {
    name: "연세의료원 강남",
    address: "강남구 도곡로",
    lat: 37.4894,
    lng: 127.0470,
    distanceKm: 2.8,
    etaMin: 12,
    score: 84,
    status: "caution",
    er: { value: 3, total: 32 },
    icu: { value: 1, total: 10 },
    or: { value: 1, total: 6 },
    capabilities: ["일반응급", "뇌졸중", "심근경색", "소아응급"],
  },
  {
    name: "강남삼성병원",
    address: "강남구 일원로",
    lat: 37.4881,
    lng: 127.0856,
    distanceKm: 4.5,
    etaMin: 22,
    score: 41,
    status: "saturated",
    er: { value: 0, total: 40 },
    icu: { value: 0, total: 14 },
    or: { value: 0, total: 8 },
    capabilities: ["뇌출혈", "중증외상", "응급수술"],
    message: "응급실 침상 포화로 인한 수용 지연 (대기 120분 이상)",
  },
  {
    name: "한양대학교병원",
    address: "성동구 왕십리로",
    lat: 37.5586,
    lng: 127.0440,

    distanceKm: 6.1,
    etaMin: 18,
    score: 76,
    status: "available",
    er: { value: 8, total: 36 },
    icu: { value: 2, total: 12 },
    or: { value: 3, total: 8 },
    capabilities: ["일반응급", "화상", "중독", "응급수술"],
  },
];

function Index() {
  const [selected, setSelected] = useState<Set<SymptomId>>(new Set());
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("위치 확인 중…");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [editingLoc, setEditingLoc] = useState(false);
  const [manualLoc, setManualLoc] = useState("");

  // 좌표 → 도로명 주소 (OpenStreetMap Nominatim, 무료/무인증)
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ko&zoom=18`,
      );
      const data = await res.json();
      const a = data.address ?? {};
      const parts = [
        a.city || a.county || a.province,
        a.borough || a.city_district || a.suburb,
        a.road,
        a.house_number,
      ].filter(Boolean);
      return parts.length ? parts.join(" ") : (data.display_name as string);
    } catch {
      return null;
    }
  };

  const acquireLocation = async () => {
    setLocating(true);
    setLocation("위치 확인 중…");
    if (!("geolocation" in navigator)) {
      setLocation("위치 권한 없음 — 직접 입력 필요");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        const addr = await reverseGeocode(lat, lng);
        setLocation(addr ?? `현재 위치 (${lat.toFixed(3)}, ${lng.toFixed(3)})`);
        setLocating(false);
      },
      () => {
        // 권한 거부 시 강남 기본값으로 폴백
        setCoords({ lat: 37.5006, lng: 127.0364 });
        setLocation("서울 강남구 테헤란로 427");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  useEffect(() => {
    acquireLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitManualLoc = async () => {
    const q = manualLoc.trim();
    if (q.length === 0) return;
    setLocation(q);
    setEditingLoc(false);
    // 입력한 주소를 좌표로 변환 (forward geocoding)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&accept-language=ko&limit=1`,
      );
      const data = await res.json();
      if (data[0]) {
        setCoords({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
      }
    } catch {
      /* 무시 */
    }
  };


  const toggleSymptom = (id: SymptomId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 검색어 기반 자동 매칭
  const matchedFromQuery = useMemo<SymptomId[]>(() => {
    const q = query.trim();
    if (!q) return [];
    return SYMPTOMS.filter((s) =>
      s.keywords.some((k) => q.includes(k)) || s.label.includes(q) || s.id.includes(q),
    ).map((s) => s.id);
  }, [query]);

  const activeSymptoms = useMemo<Set<SymptomId>>(() => {
    const s = new Set<SymptomId>(selected);
    matchedFromQuery.forEach((id) => s.add(id));
    return s;
  }, [selected, matchedFromQuery]);

  const filteredHospitals = useMemo(() => {
    if (activeSymptoms.size === 0) return HOSPITALS;
    // 가능성이 여러 개일 수 있으므로 OR 매칭: 후보 중 하나라도 수용 가능하면 표시
    return HOSPITALS.filter((h) =>
      [...activeSymptoms].some((s) => h.capabilities.includes(s)),
    );
  }, [activeSymptoms]);

  const top = filteredHospitals[0];
  const rest = filteredHospitals.slice(1);

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-brand px-4 pb-4 pt-6 text-brand-foreground">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-white/50">
              현재 위치
            </p>
            {editingLoc ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  autoFocus
                  value={manualLoc}
                  onChange={(e) => setManualLoc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitManualLoc()}
                  placeholder="주소 또는 지역명 입력"
                  className="min-w-0 flex-1 rounded-md bg-white/10 px-2 py-1 text-sm text-white placeholder:text-white/40 ring-1 ring-white/20 focus:outline-none focus:ring-white/60"
                />
                <button
                  onClick={submitManualLoc}
                  aria-label="저장"
                  className="rounded-md bg-white p-1.5 text-brand"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h1 className="mt-1 flex items-center gap-2 truncate text-base font-bold">
                <MapPin className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{location}</span>
                {!locating && (
                  <span className="size-2 flex-shrink-0 animate-pulse-slow rounded-full bg-status-green" />
                )}
              </h1>
            )}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={acquireLocation}
              aria-label="내 위치 다시 찾기"
              className="rounded-lg bg-white/10 p-2 ring-1 ring-white/10 active:scale-95"
            >
              <LocateFixed className={"h-4 w-4 " + (locating ? "animate-spin" : "")} />
            </button>
            <button
              onClick={() => {
                setEditingLoc((v) => !v);
                setManualLoc("");
              }}
              aria-label="위치 직접 입력"
              className="rounded-lg bg-white/10 p-2 ring-1 ring-white/10 active:scale-95"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 증상 검색 */}
        <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10 focus-within:ring-white/40">
          <Search className="h-4 w-4 text-white/70" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="증상을 입력하세요 (예: 가슴이 답답하고 식은땀)"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none"
          />
        </div>
        <p className="mb-2 px-1 text-[10px] text-white/60">
          입력한 증상에 해당할 수 있는 모든 진료군이 자동 체크됩니다.
        </p>


        {/* 증상 체크 칩 */}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {SYMPTOMS.map((s) => {
            const active = activeSymptoms.has(s.id);
            const fromQuery = matchedFromQuery.includes(s.id) && !selected.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggleSymptom(s.id)}
                className={
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition-colors " +
                  (active
                    ? fromQuery
                      ? "bg-status-amber text-brand"
                      : "bg-white text-brand"
                    : "border border-white/10 bg-white/10 text-white/80")
                }
              >
                {active && <Check className="-ml-0.5 mr-1 inline h-3 w-3" />}
                {s.id}
              </button>
            );
          })}
        </div>
      </header>

      <main className="flex-1 space-y-5 px-4 py-6">
        {/* 실시간 지도 */}
        <section className="animate-entrance overflow-hidden rounded-2xl ring-1 ring-black/5">
          <div className="relative h-56 w-full">
            <LiveMap coords={coords} hospitals={filteredHospitals} />
            <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded bg-white/95 px-2 py-1 text-[10px] font-bold shadow-sm ring-1 ring-black/5">
              <span className="size-1.5 animate-pulse-slow rounded-full bg-status-green" />
              실시간 갱신 중
            </div>
          </div>
        </section>


        {/* Recommendations */}
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <h2 className="font-mono text-sm font-bold uppercase tracking-tight text-muted-foreground">
              추천 응급실 ({filteredHospitals.length})
            </h2>
            <span className="font-mono text-[10px] text-muted-foreground">
              {activeSymptoms.size > 0
                ? `${activeSymptoms.size}개 증상 필터`
                : "전체 표시"}
            </span>
          </div>

          {!top && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              선택한 증상을 모두 수용 가능한 병원이 현재 없습니다.
              <br />
              증상을 줄이거나 반경을 확장해 주세요.
            </div>
          )}

          {/* Top card */}
          {top && (
            <article
              className="animate-entrance relative rounded-2xl bg-card p-4 shadow-xl ring-2 ring-brand"
              style={{ animationDelay: "100ms" }}
            >
              <div className="absolute -top-3 left-4 rounded-full bg-brand px-3 py-1 font-mono text-[10px] font-black italic tracking-tighter text-brand-foreground">
                추천 1순위
              </div>

              <div className="mb-4 flex items-start justify-between">
                <div className="space-y-1">
                  <h3 className="text-xl font-black tracking-tight">{top.name}</h3>
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span>
                      {top.address} · {top.distanceKm}km
                    </span>
                    <span className="h-2 w-px bg-border" />
                    <span className="font-semibold text-brand">
                      구급차 {top.etaMin}분
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black leading-none text-brand">
                    {top.score}
                  </div>
                  <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-tighter text-muted-foreground">
                    적합도
                  </div>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-3 gap-2">
                <BedStat label="응급실" tone="green" value={top.er.value} total={top.er.total} state="여유" />
                <BedStat label="중환자실" tone="neutral" value={top.icu.value} total={top.icu.total} state="보통" />
                <BedStat label="수술실" tone="neutral" value={top.or.value} total={top.or.total} state="가능" />
              </div>

              <div className="mb-5 flex flex-wrap gap-1.5">
                {top.capabilities.map((c) => (
                  <span
                    key={c}
                    className={
                      "rounded px-2 py-1 text-[10px] font-bold ring-1 " +
                      (activeSymptoms.has(c)
                        ? "bg-brand text-brand-foreground ring-brand"
                        : "bg-brand/5 text-brand ring-brand/10")
                    }
                  >
                    {c} 수용가능
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <button className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-4 font-bold text-brand-foreground transition-transform active:scale-95">
                  <Phone className="h-4 w-4" />
                  전화 연결
                </button>
                <button className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-card py-4 font-bold ring-1 ring-border transition-transform active:scale-95">
                  <Navigation className="h-4 w-4" />
                  길찾기
                </button>
              </div>
            </article>
          )}

          {/* Rest cards */}
          {rest.map((h, i) => (
            <article
              key={h.name}
              className={
                "animate-entrance rounded-2xl p-4 ring-1 ring-black/5 " +
                (h.status === "saturated" ? "bg-muted/40" : "bg-card")
              }
              style={{ animationDelay: `${200 + i * 100}ms` }}
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3
                    className={
                      "text-lg font-bold tracking-tight " +
                      (h.status === "saturated" ? "text-muted-foreground" : "")
                    }
                  >
                    {h.name}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {h.address} · {h.distanceKm}km · {h.etaMin}분
                  </p>
                </div>
                <StatusBadge status={h.status} />
              </div>

              {h.status === "saturated" ? (
                <div className="flex items-start gap-2 rounded-lg border border-status-red/15 bg-status-red/5 p-2 text-xs font-medium text-status-red">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{h.message ?? "수용 불가"}</span>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex gap-6">
                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase text-muted-foreground">
                        응급실
                      </p>
                      <p
                        className={
                          "text-xl font-black " +
                          (h.status === "caution" ? "text-status-amber" : "text-status-green")
                        }
                      >
                        {String(h.er.value).padStart(2, "0")}
                        <span className="text-xs font-normal opacity-50">
                          /{h.er.total}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase text-muted-foreground">
                        적합도
                      </p>
                      <p className="text-xl font-black">{h.score}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      aria-label="전화"
                      className="flex size-10 items-center justify-center rounded-lg ring-1 ring-border active:scale-95"
                    >
                      <Phone className="h-4 w-4" />
                    </button>
                    <button
                      aria-label="길찾기"
                      className="flex size-10 items-center justify-center rounded-lg ring-1 ring-border active:scale-95"
                    >
                      <Navigation className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}

          <button className="flex w-full items-center justify-center gap-1 py-3 font-mono text-xs font-bold text-muted-foreground">
            반경 확장 후 더 보기
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </section>
      </main>

      <footer className="border-t border-border p-4">
        <div className="flex items-center justify-between rounded-2xl bg-foreground p-4">
          <div className="flex items-center gap-3">
            <span className="size-2 animate-pulse-slow rounded-full bg-status-green" />
            <p className="text-xs font-bold text-background">
              공공 응급의료 데이터 실시간 연결 중
            </p>
          </div>
          <span className="font-mono text-[10px] text-background/40">
            ER-NAVI v1.0
          </span>
        </div>
      </footer>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "available")
    return (
      <span className="rounded bg-status-green/10 px-2 py-1 font-mono text-[10px] font-black uppercase text-status-green">
        수용가능
      </span>
    );
  if (status === "caution")
    return (
      <span className="rounded bg-status-amber/10 px-2 py-1 font-mono text-[10px] font-black uppercase text-status-amber">
        주의
      </span>
    );
  return (
    <span className="rounded bg-status-red/10 px-2 py-1 font-mono text-[10px] font-black uppercase text-status-red">
      포화
    </span>
  );
}

function LiveMap({
  coords,
  hospitals,
}: {
  coords: { lat: number; lng: number } | null;
  hospitals: Hospital[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // 지도 초기화 (1회)
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, {
      center: [37.5, 127.04],
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19 },
    ).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 마커 갱신
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const points: L.LatLngExpression[] = [];

    if (coords) {
      const meIcon = L.divIcon({
        className: "",
        html: `<div style="position:relative"><div style="width:18px;height:18px;border-radius:9999px;background:oklch(0.65 0.22 250);border:3px solid white;box-shadow:0 0 0 4px oklch(0.65 0.22 250 / 0.3)"></div></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([coords.lat, coords.lng], { icon: meIcon })
        .bindPopup("<b>내 위치</b>")
        .addTo(layer);
      points.push([coords.lat, coords.lng]);
    }

    hospitals.forEach((h, i) => {
      const color =
        h.status === "available"
          ? "oklch(0.72 0.17 162)"
          : h.status === "caution"
            ? "oklch(0.78 0.17 71)"
            : "oklch(0.65 0.24 27)";
      const isTop = i === 0;
      const size = isTop ? 32 : 26;
      const icon = L.divIcon({
        className: "",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:${color};color:white;font-weight:900;font-size:${isTop ? 13 : 11}px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${i + 1}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      L.marker([h.lat, h.lng], { icon })
        .bindPopup(`<b>${h.name}</b><br/>${h.address}`)
        .addTo(layer);
      points.push([h.lat, h.lng]);
    });

    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 14 });
    }
  }, [coords, hospitals]);

  return <div ref={ref} className="h-full w-full" />;
}

function BedStat({
  label,
  value,
  total,
  state,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  state: string;
  tone: "green" | "neutral" | "red" | "amber";
}) {
  const styles =
    tone === "green"
      ? "bg-status-green/10 border-status-green/20 text-status-green"
      : "bg-muted border-border text-foreground";
  const stateColor =
    tone === "green" ? "text-status-green" : "text-muted-foreground";
  return (
    <div className={`rounded-xl border p-3 ${styles}`}>
      <div className="mb-1 font-mono text-[10px] font-bold uppercase opacity-80">
        {label}
      </div>
      <div className="text-2xl font-black">
        {String(value).padStart(2, "0")}
        <span className="text-sm opacity-50">/{total}</span>
      </div>
      <div className={`mt-1 text-[10px] font-bold ${stateColor}`}>{state}</div>
    </div>
  );
}
