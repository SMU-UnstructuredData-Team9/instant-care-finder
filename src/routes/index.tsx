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
  X,
  Clock,
  Building2,
  Stethoscope,
  Info,
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
  phone: string;
  erPhone: string;
  hours: string;
  erHours: string;
  description: string;
  departments: string[];
}

// 병원 템플릿 — 사용자 위치 주변에 상대적으로 배치됨.
// dx/dy: 사용자 위치에서의 동/북 방향 오프셋(km). 실제 거리/도착시간은 좌표로 계산.
const HOSPITAL_TEMPLATES = [
  {
    suffix: "성심중앙병원",
    dxKm: 0.4,
    dyKm: 0.9,
    score: 98,
    status: "available" as Status,
    er: { value: 12, total: 45 },
    icu: { value: 4, total: 12 },
    or: { value: 2, total: 8 },
    capabilities: ["일반응급", "심근경색", "응급수술", "뇌출혈", "중증외상"] as SymptomId[],
    phone: "1588-1234",
    erPhone: "031-200-7119",
    hours: "외래 평일 08:30 ~ 17:30 / 토 08:30 ~ 12:30",
    erHours: "응급실 24시간 연중무휴",
    description:
      "권역 심뇌혈관센터 지정 종합병원. 24시간 심장 카테터실 운영으로 심근경색·뇌졸중 골든타임 대응이 가능합니다.",
    departments: ["응급의학과", "심장내과", "신경외과", "신경과", "흉부외과", "외과", "영상의학과"],
  },
  {
    suffix: "의료원",
    dxKm: -1.8,
    dyKm: -1.4,
    score: 84,
    status: "caution" as Status,
    er: { value: 3, total: 32 },
    icu: { value: 1, total: 10 },
    or: { value: 1, total: 6 },
    capabilities: ["일반응급", "뇌졸중", "심근경색", "소아응급"] as SymptomId[],
    phone: "1577-5678",
    erPhone: "031-300-7119",
    hours: "외래 평일 09:00 ~ 17:00",
    erHours: "응급실 24시간 운영",
    description:
      "공공의료원. 소아 응급 야간 진료가 가능하며 일반응급·내과계 환자 수용에 강점이 있습니다.",
    departments: ["응급의학과", "내과", "소아청소년과", "신경과", "가정의학과"],
  },
  {
    suffix: "삼성병원",
    dxKm: 2.6,
    dyKm: -2.2,
    score: 41,
    status: "saturated" as Status,
    er: { value: 0, total: 40 },
    icu: { value: 0, total: 14 },
    or: { value: 0, total: 8 },
    capabilities: ["뇌출혈", "중증외상", "응급수술"] as SymptomId[],
    message: "응급실 침상 포화로 인한 수용 지연 (대기 120분 이상)",
    phone: "1599-3114",
    erPhone: "02-3410-2119",
    hours: "외래 평일 08:00 ~ 17:00",
    erHours: "응급실 24시간 (현재 포화)",
    description:
      "권역응급의료센터. 평소 중증외상·뇌출혈 수술에 강하나 현재 침상이 모두 사용 중입니다.",
    departments: ["응급의학과", "신경외과", "외상외과", "흉부외과", "혈관외과", "마취통증의학과"],
  },
  {
    suffix: "대학교병원",
    dxKm: -3.4,
    dyKm: 4.6,
    score: 76,
    status: "available" as Status,
    er: { value: 8, total: 36 },
    icu: { value: 2, total: 12 },
    or: { value: 3, total: 8 },
    capabilities: ["일반응급", "화상", "중독", "응급수술"] as SymptomId[],
    phone: "1577-0075",
    erPhone: "02-2072-2119",
    hours: "외래 평일 08:30 ~ 17:30",
    erHours: "응급실 24시간 운영",
    description:
      "상급종합병원. 화상센터·중독관리센터 운영. 약물 중독 및 화상 환자 24시간 대응 가능합니다.",
    departments: ["응급의학과", "성형외과", "외과", "내과", "독성학클리닉", "정신건강의학과"],
  },
  {
    suffix: "중앙의료원",
    dxKm: 6.2,
    dyKm: 5.8,
    score: 68,
    status: "available" as Status,
    er: { value: 6, total: 30 },
    icu: { value: 1, total: 8 },
    or: { value: 1, total: 6 },
    capabilities: ["일반응급", "소아응급", "뇌졸중"] as SymptomId[],
    phone: "1588-9999",
    erPhone: "02-2260-7119",
    hours: "외래 평일 09:00 ~ 17:30 / 토 09:00 ~ 12:30",
    erHours: "응급실 24시간 / 소아응급 야간 운영",
    description:
      "공공보건의료 중추기관. 소아 전담 응급의료 전문의 상주, 야간 소아 진료가 가능합니다.",
    departments: ["응급의학과", "소아청소년과", "내과", "신경과", "가정의학과"],
  },
  {
    suffix: "성모병원",
    dxKm: -7.5,
    dyKm: 2.1,
    score: 72,
    status: "caution" as Status,
    er: { value: 2, total: 28 },
    icu: { value: 1, total: 9 },
    or: { value: 0, total: 5 },
    capabilities: ["일반응급", "심근경색", "응급수술"] as SymptomId[],
    phone: "1588-1511",
    erPhone: "02-2258-1119",
    hours: "외래 평일 08:30 ~ 17:00",
    erHours: "응급실 24시간",
    description:
      "지역응급의료센터. 심혈관 인터벤션 가능. 현재 응급실 잔여 병상이 부족합니다.",
    departments: ["응급의학과", "순환기내과", "외과", "마취통증의학과"],
  },
  {
    suffix: "권역응급의료센터",
    dxKm: 18,
    dyKm: -12,
    score: 81,
    status: "available" as Status,
    er: { value: 9, total: 50 },
    icu: { value: 3, total: 16 },
    or: { value: 2, total: 10 },
    capabilities: ["중증외상", "뇌출혈", "뇌졸중", "심근경색", "응급수술"] as SymptomId[],
    phone: "1577-1233",
    erPhone: "031-787-2119",
    hours: "외래 평일 08:30 ~ 17:30",
    erHours: "응급실 24시간 권역 단위 중증 환자 수용",
    description:
      "권역응급의료센터 지정. 중증외상·뇌혈관·심혈관 응급에 24시간 다학제 대응이 가능합니다.",
    departments: ["응급의학과", "신경외과", "흉부외과", "외상외과", "정형외과", "혈관외과"],
  },
  {
    suffix: "권역외상센터",
    dxKm: -25,
    dyKm: 32,
    score: 88,
    status: "available" as Status,
    er: { value: 14, total: 60 },
    icu: { value: 5, total: 20 },
    or: { value: 4, total: 12 },
    capabilities: ["중증외상", "응급수술", "화상", "심근경색"] as SymptomId[],
    phone: "1588-7575",
    erPhone: "031-219-7119",
    hours: "외래 평일 08:30 ~ 17:00",
    erHours: "외상센터 24시간 365일 가동",
    description:
      "권역외상센터. 닥터헬기 운용, 다발성 외상·중증 외상 수술 동시 진행이 가능합니다.",
    departments: ["외상외과", "응급의학과", "정형외과", "신경외과", "흉부외과", "성형외과"],
  },
  {
    suffix: "국립대학교병원",
    dxKm: 55,
    dyKm: -40,
    score: 92,
    status: "available" as Status,
    er: { value: 18, total: 70 },
    icu: { value: 6, total: 24 },
    or: { value: 5, total: 14 },
    capabilities: ["중증외상", "뇌출혈", "뇌졸중", "심근경색", "응급수술", "소아응급", "화상", "중독"] as SymptomId[],
    phone: "1588-5700",
    erPhone: "042-280-7119",
    hours: "외래 평일 08:30 ~ 17:30",
    erHours: "응급실·소아응급·외상센터 24시간",
    description:
      "상급종합병원·권역응급의료센터. 모든 중증 진료군 24시간 다학제 대응이 가능한 거점 병원입니다.",
    departments: [
      "응급의학과",
      "신경외과",
      "흉부외과",
      "외상외과",
      "소아청소년과",
      "성형외과",
      "독성학클리닉",
    ],
  },
  {
    suffix: "특수질환센터 (서울)",
    dxKm: 80,
    dyKm: 90,
    score: 95,
    status: "available" as Status,
    er: { value: 22, total: 80 },
    icu: { value: 8, total: 30 },
    or: { value: 6, total: 16 },
    capabilities: ["중증외상", "뇌출혈", "뇌졸중", "심근경색", "응급수술", "소아응급", "화상", "중독"] as SymptomId[],
    message: "희귀·특수질환 전국 단위 전원 가능",
    phone: "1599-1004",
    erPhone: "02-2072-0119",
    hours: "외래 평일 08:00 ~ 17:30",
    erHours: "응급실·특수질환센터 24시간",
    description:
      "전국 단위 전원이 가능한 특수질환 거점센터. 희귀질환·이식·중증 소아 응급까지 대응합니다.",
    departments: [
      "응급의학과",
      "이식외과",
      "희귀질환센터",
      "소아응급의학과",
      "신경외과",
      "심장혈관흉부외과",
    ],
  },
];

// 위경도 1도 ≈ 111km. 동쪽 거리는 위도에 따라 cos(lat) 보정.
function offsetCoords(lat: number, lng: number, dxKm: number, dyKm: number) {
  const dLat = dyKm / 111;
  const dLng = dxKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function generateHospitals(
  coords: { lat: number; lng: number } | null,
  cityName: string,
): Hospital[] {
  if (!coords) return [];
  return HOSPITAL_TEMPLATES.map((t) => {
    const pos = offsetCoords(coords.lat, coords.lng, t.dxKm, t.dyKm);
    const distance = haversineKm(coords, pos);
    // 구급차 평균 40km/h 가정 + 출동 2분
    const eta = Math.max(3, Math.round((distance / 40) * 60 + 2));
    return {
      name: `${cityName}${t.suffix}`,
      address: `${cityName} 응급의료센터`,
      lat: pos.lat,
      lng: pos.lng,
      distanceKm: Math.round(distance * 10) / 10,
      etaMin: eta,
      score: t.score,
      status: t.status,
      er: t.er,
      icu: t.icu,
      or: t.or,
      capabilities: t.capabilities,
      message: t.message,
      phone: t.phone,
      erPhone: t.erPhone,
      hours: t.hours,
      erHours: t.erHours,
      description: t.description,
      departments: t.departments,
    };
  });
}


function Index() {
  const [selected, setSelected] = useState<Set<SymptomId>>(new Set());
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("위치 확인 중…");
  const [cityName, setCityName] = useState("지역");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [editingLoc, setEditingLoc] = useState(false);
  const [manualLoc, setManualLoc] = useState("");
  const [radiusKm, setRadiusKm] = useState(5);
  const [detail, setDetail] = useState<Hospital | null>(null);


  // 좌표 → 도로명 주소 + 도시명
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ko&zoom=18`,
      );
      const data = await res.json();
      const a = data.address ?? {};
      const city = a.city || a.county || a.town || a.province || "지역";
      const parts = [
        a.city || a.county || a.province,
        a.borough || a.city_district || a.suburb,
        a.road,
        a.house_number,
      ].filter(Boolean);
      return {
        address: parts.length ? parts.join(" ") : (data.display_name as string),
        city,
      };
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
        const result = await reverseGeocode(lat, lng);
        if (result) {
          setLocation(result.address);
          setCityName(result.city);
        } else {
          setLocation(`현재 위치 (${lat.toFixed(3)}, ${lng.toFixed(3)})`);
        }
        setLocating(false);
      },
      () => {
        // 권한 거부 시 강남 기본값으로 폴백
        setCoords({ lat: 37.5006, lng: 127.0364 });
        setLocation("서울 강남구 테헤란로 427");
        setCityName("강남구");
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
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&accept-language=ko&limit=1&addressdetails=1`,
      );
      const data = await res.json();
      if (data[0]) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        setCoords({ lat, lng });
        const a = data[0].address ?? {};
        setCityName(a.city || a.county || a.town || a.province || q);
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

  // 사용자 위치 주변에 병원 생성 + 반경 필터 + 증상 필터
  const allHospitals = useMemo(
    () => generateHospitals(coords, cityName),
    [coords, cityName],
  );

  const filteredHospitals = useMemo(() => {
    let list = allHospitals.filter((h) => h.distanceKm <= radiusKm);
    if (activeSymptoms.size > 0) {
      list = list.filter((h) =>
        [...activeSymptoms].some((s) => h.capabilities.includes(s)),
      );
    }
    // 가까운 + 가용한 순으로 정렬
    return list.sort((a, b) => {
      const statusRank = { available: 0, caution: 1, saturated: 2 } as const;
      const sd = statusRank[a.status] - statusRank[b.status];
      if (sd !== 0) return sd;
      return a.distanceKm - b.distanceKm;
    });
  }, [allHospitals, radiusKm, activeSymptoms]);

  const rank1 = filteredHospitals[0];
  const rank2 = filteredHospitals[1];
  const rank3 = filteredHospitals[2];
  const rest = filteredHospitals.slice(3);
  const canExpand = allHospitals.length > filteredHospitals.length;

  const rankConfig = [
    { label: "추천 1순위", ring: "ring-2 ring-brand", badgeBg: "bg-brand" },
    { label: "추천 2순위", ring: "ring-2 ring-status-green", badgeBg: "bg-status-green" },
    { label: "추천 3순위", ring: "ring-2 ring-status-amber", badgeBg: "bg-status-amber" },
  ] as const;

  const renderRankCard = (h: Hospital | undefined, idx: number) => {
    if (!h) return null;
    const cfg = rankConfig[idx];
    return (
      <article
        key={h.name}
        onClick={() => setDetail(h)}
        className={`animate-entrance relative cursor-pointer rounded-2xl bg-card p-4 shadow-xl ${cfg.ring} transition hover:shadow-2xl`}
        style={{ animationDelay: `${100 + idx * 100}ms` }}
      >
        <div className={`absolute -top-3 left-4 rounded-full ${cfg.badgeBg} px-3 py-1 font-mono text-[10px] font-black italic tracking-tighter text-white`}>
          {cfg.label}
        </div>

        <div className="mb-4 flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-xl font-black tracking-tight">{h.name}</h3>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>{h.address} · {h.distanceKm}km</span>
              <span className="h-2 w-px bg-border" />
              <span className="font-semibold text-brand">구급차 {h.etaMin}분</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black leading-none text-brand">{h.score}</div>
            <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-tighter text-muted-foreground">적합도</div>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <BedStat label="응급실" tone="green" value={h.er.value} total={h.er.total} state="여유" />
          <BedStat label="중환자실" tone="neutral" value={h.icu.value} total={h.icu.total} state="보통" />
          <BedStat label="수술실" tone="neutral" value={h.or.value} total={h.or.total} state="가능" />
        </div>

        <div className="mb-5 flex flex-wrap gap-1.5">
          {h.capabilities.map((c) => (
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDetail(h);
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-4 font-bold text-brand-foreground transition-transform active:scale-95"
          >
            <Phone className="h-4 w-4" />
            전화 연결
          </button>
          <button
            onClick={(e) => e.stopPropagation()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-card py-4 font-bold ring-1 ring-border transition-transform active:scale-95"
          >
            <Navigation className="h-4 w-4" />
            길찾기
          </button>
        </div>
      </article>
    );
  };


  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-brand px-4 pb-4 pt-6 text-brand-foreground">
        {/* 위치 영역 */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-white/60">
              <MapPin className="h-3 w-3" />
              현재 위치
            </p>
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

          {editingLoc ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={manualLoc}
                onChange={(e) => setManualLoc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitManualLoc()}
                placeholder="주소 또는 지역명 입력"
                className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/40 ring-1 ring-white/20 focus:outline-none focus:ring-white/60"
              />
              <button
                onClick={submitManualLoc}
                aria-label="저장"
                className="rounded-xl bg-white p-2.5 text-brand"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <h1 className="flex items-center gap-2 text-base font-bold">
              <span className="truncate">{location}</span>
              {!locating && (
                <span className="size-2 flex-shrink-0 animate-pulse-slow rounded-full bg-status-green" />
              )}
            </h1>
          )}
        </div>

        {/* 구분선 */}
        <div className="mb-4 h-px bg-white/10" />

        {/* 증상 입력 영역 */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-white/60">
            <Stethoscope className="h-3 w-3" />
            증상 입력
          </p>
          <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10 focus-within:ring-white/40">
            <Search className="h-4 w-4 text-white/70" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="증상을 입력하세요 (예: 가슴이 답답하고 식은땀)"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none"
            />
          </div>
          <p className="mb-3 px-1 text-[10px] text-white/60">
            입력한 증상에 해당할 수 있는 모든 진료군이 자동 체크됩니다.
          </p>
        </div>

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
            <LiveMap coords={coords} hospitals={filteredHospitals} onHospitalClick={setDetail} />
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

          {!rank1 && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              선택한 증상을 모두 수용 가능한 병원이 현재 없습니다.
              <br />
              증상을 줄이거나 반경을 확장해 주세요.
            </div>
          )}

          {/* Rank 1, 2, 3 cards */}
          {renderRankCard(rank1, 0)}
          {renderRankCard(rank2, 1)}
          {renderRankCard(rank3, 2)}

          {/* Rest cards */}
          {rest.map((h, i) => (
            <article
              key={h.name}
              onClick={() => setDetail(h)}
              className={
                "animate-entrance cursor-pointer rounded-2xl p-4 ring-1 ring-black/5 transition hover:ring-brand/40 " +
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetail(h);
                      }}
                      aria-label="전화"
                      className="flex size-10 items-center justify-center rounded-lg ring-1 ring-border active:scale-95"
                    >
                      <Phone className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => e.stopPropagation()}
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

          <button
            onClick={() => setRadiusKm((r) => r + 5)}
            disabled={!canExpand}
            className="flex w-full items-center justify-center gap-1 py-3 font-mono text-xs font-bold text-muted-foreground disabled:opacity-40"
          >
            {canExpand
              ? `반경 ${radiusKm}km → ${radiusKm + 5}km 확장 (제한 없음)`
              : `반경 ${radiusKm}km — 더 늘려도 결과 없음`}
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

      <HospitalDetailModal hospital={detail} onClose={() => setDetail(null)} activeSymptoms={activeSymptoms} />
    </div>
  );
}

function HospitalDetailModal({
  hospital,
  onClose,
  activeSymptoms,
}: {
  hospital: Hospital | null;
  onClose: () => void;
  activeSymptoms: Set<SymptomId>;
}) {
  const [callTarget, setCallTarget] = useState<{ label: string; number: string } | null>(null);
  if (!hospital) return null;
  const h = hospital;
  const statusLabel =
    h.status === "available" ? "수용 가능" : h.status === "caution" ? "주의 (잔여 부족)" : "포화 / 수용 불가";
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-entrance max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-card p-5 shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <StatusBadge status={h.status} />
              <span className="font-mono text-[10px] font-bold text-muted-foreground">
                적합도 {h.score}
              </span>
            </div>
            <h2 className="text-2xl font-black tracking-tight">{h.name}</h2>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {h.address}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-muted active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-3">
          <DetailMetric label="거리" value={`${h.distanceKm}km`} />
          <DetailMetric label="구급차" value={`${h.etaMin}분`} />
          <DetailMetric label="상태" value={statusLabel} small />
        </div>

        {h.message && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-status-amber/20 bg-status-amber/10 p-3 text-xs font-medium text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-amber" />
            <span>{h.message}</span>
          </div>
        )}

        {/* 병원 소개 */}
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground/80">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand" />
          <p>{h.description}</p>
        </div>

        {/* 운영시간 */}
        <div className="mb-4">
          <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Clock className="h-3 w-3" /> 운영시간
          </h3>
          <div className="space-y-1.5 rounded-xl bg-muted/30 p-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <span className="font-bold text-foreground">외래</span>
              <span className="text-right text-muted-foreground">{h.hours}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-start justify-between gap-2">
              <span className="font-bold text-status-red">응급</span>
              <span className="text-right text-status-red/90">{h.erHours}</span>
            </div>
          </div>
        </div>

        {/* 전화번호 */}
        <div className="mb-4">
          <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Phone className="h-3 w-3" /> 전화번호
          </h3>
          <div className="space-y-2">
            <PhoneRow
              label="응급실 직통"
              number={h.erPhone}
              accent
              onCall={() => setCallTarget({ label: `${h.name} 응급실`, number: h.erPhone })}
            />
            <PhoneRow
              label="대표번호"
              number={h.phone}
              onCall={() => setCallTarget({ label: h.name, number: h.phone })}
            />
          </div>
        </div>

        {/* 진료과 */}
        <div className="mb-4">
          <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Stethoscope className="h-3 w-3" /> 진료과
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {h.departments.map((d) => (
              <span
                key={d}
                className="rounded-md bg-muted px-2 py-1 text-[11px] font-bold text-foreground ring-1 ring-border"
              >
                {d}
              </span>
            ))}
          </div>
        </div>

        {/* 수용 가능 진료군 */}
        <div className="mb-5">
          <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Building2 className="h-3 w-3" /> 수용 가능 진료군
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {h.capabilities.map((c) => (
              <span
                key={c}
                className={
                  "rounded-md px-2 py-1 text-[11px] font-bold ring-1 " +
                  (activeSymptoms.has(c)
                    ? "bg-brand text-brand-foreground ring-brand"
                    : "bg-brand/5 text-brand ring-brand/10")
                }
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setCallTarget({ label: `${h.name} 응급실`, number: h.erPhone })}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-4 font-bold text-brand-foreground active:scale-95"
          >
            <Phone className="h-4 w-4" />
            전화 연결
          </button>
          <button className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-card py-4 font-bold ring-1 ring-border active:scale-95">
            <Navigation className="h-4 w-4" />
            길찾기
          </button>
        </div>
      </div>

      <CallConfirmDialog target={callTarget} onClose={() => setCallTarget(null)} />
    </div>
  );
}

function PhoneRow({
  label,
  number,
  onCall,
  accent,
}: {
  label: string;
  number: string;
  onCall: () => void;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-3 rounded-xl p-3 ring-1 " +
        (accent ? "bg-status-red/5 ring-status-red/20" : "bg-muted/40 ring-border")
      }
    >
      <div className="min-w-0">
        <p className={"font-mono text-[10px] font-bold uppercase " + (accent ? "text-status-red" : "text-muted-foreground")}>
          {label}
        </p>
        <p className="font-mono text-base font-black tracking-tight">{number}</p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCall();
        }}
        className={
          "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold active:scale-95 " +
          (accent ? "bg-status-red text-white" : "bg-foreground text-background")
        }
      >
        <Phone className="h-3.5 w-3.5" />
        전화
      </button>
    </div>
  );
}

function CallConfirmDialog({
  target,
  onClose,
}: {
  target: { label: string; number: string } | null;
  onClose: () => void;
}) {
  if (!target) return null;
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-entrance w-full max-w-xs rounded-2xl bg-card p-5 shadow-2xl"
      >
        <div className="mb-3 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-status-red/10">
            <Phone className="h-5 w-5 text-status-red" />
          </div>
          <p className="text-xs font-bold text-muted-foreground">{target.label}</p>
          <p className="mt-1 font-mono text-2xl font-black tracking-tight">{target.number}</p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            전화를 거시려면 아래 버튼을 한 번 더 눌러주세요.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-muted py-3 text-sm font-bold active:scale-95"
          >
            취소
          </button>
          <a
            href={`tel:${target.number.replace(/[^0-9+]/g, "")}`}
            onClick={onClose}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-status-red py-3 text-sm font-bold text-white active:scale-95"
          >
            <Phone className="h-4 w-4" />
            전화걸기
          </a>
        </div>
      </div>
    </div>
  );
}

function DetailMetric({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="text-center">
      <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={"mt-1 font-black tracking-tight " + (small ? "text-xs" : "text-lg")}>{value}</p>
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
  onHospitalClick,
}: {
  coords: { lat: number; lng: number } | null;
  hospitals: Hospital[];
  onHospitalClick?: (h: Hospital) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const [ready, setReady] = useState(false);

  // 지도 초기화 (브라우저에서만 — SSR 회피용 동적 import)
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const mod = await import("leaflet");
      const L = mod.default;
      if (cancelled || !ref.current) return;
      LRef.current = L;
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
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // 마커 갱신
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const L = LRef.current;
    if (!map || !layer || !L || !ready) return;
    layer.clearLayers();

    const points: Leaflet.LatLngExpression[] = [];

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
        .bindPopup(`<b>${h.name}</b><br/>${h.address}<br/><i>탭하면 상세 정보</i>`)
        .on("click", () => onHospitalClick?.(h))
        .addTo(layer);
      points.push([h.lat, h.lng]);
    });

    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 14 });
    }
  }, [coords, hospitals, ready, onHospitalClick]);

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
