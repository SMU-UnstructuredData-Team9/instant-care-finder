import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, Phone, Navigation, Activity, AlertTriangle, ChevronRight } from "lucide-react";
import dispatchMap from "@/assets/dispatch-map.jpg";

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

const FILTERS = ["전체", "심근경색", "뇌졸중", "뇌출혈", "중증외상", "응급수술"] as const;

type Status = "available" | "caution" | "saturated";

const TOP_HOSPITAL = {
  name: "서울성심중앙병원",
  address: "강남구 삼성로 · 1.2km",
  eta: "구급차 6분",
  score: 98,
  beds: {
    er: { value: 12, total: 45 },
    icu: { value: 4, total: 12 },
    or: { value: 2, total: 8 },
  },
  capabilities: ["심근경색 수용가능", "24시간 응급수술", "뇌출혈 가능"],
};

const SECOND_HOSPITAL = {
  name: "연세의료원 강남",
  address: "강남구 도곡로 · 2.8km · 12분",
  score: 84,
  er: 3,
  erTotal: 32,
};

const THIRD_HOSPITAL = {
  name: "강남삼성병원",
  address: "강남구 일원로 · 4.5km · 22분",
  message: "응급실 침상 포화로 인한 수용 지연 (대기 120분 이상)",
};

function Index() {
  const [activeFilter, setActiveFilter] = useState<string>("전체");

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-brand px-4 pb-4 pt-6 text-brand-foreground">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-white/50">
              Current Location
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-lg font-bold">
              <MapPin className="h-4 w-4" />
              서울 강남구 테헤란로 427
              <span className="size-2 animate-pulse-slow rounded-full bg-status-green" />
            </h1>
          </div>
          <button
            aria-label="반경 설정"
            className="rounded-lg bg-white/10 p-2 ring-1 ring-white/10 active:scale-95"
          >
            <Activity className="h-5 w-5 text-white/90" />
          </button>
        </div>

        {/* Filter chips */}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {FILTERS.map((f) => {
            const active = activeFilter === f;
            return (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition-colors " +
                  (active
                    ? "bg-white text-brand"
                    : "border border-white/10 bg-white/10 text-white/80")
                }
              >
                {f}
              </button>
            );
          })}
        </div>
      </header>

      <main className="flex-1 space-y-5 px-4 py-6">
        {/* Mini map */}
        <section className="animate-entrance overflow-hidden rounded-2xl ring-1 ring-black/5">
          <div className="relative h-32 w-full">
            <img
              src={dispatchMap}
              alt="응급의료 디스패치 지도"
              width={1024}
              height={512}
              className="h-full w-full object-cover"
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded bg-white/95 px-2 py-1 text-[10px] font-bold shadow-sm ring-1 ring-black/5">
              <span className="size-1.5 animate-pulse-slow rounded-full bg-status-green" />
              LIVE UPDATING
            </div>
          </div>
        </section>

        {/* Recommendations */}
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <h2 className="font-mono text-sm font-bold uppercase tracking-tight text-muted-foreground">
              Optimal Recommendations
            </h2>
            <span className="font-mono text-[10px] text-muted-foreground">
              Updated 14:22:05
            </span>
          </div>

          {/* Top card */}
          <article
            className="animate-entrance relative rounded-2xl bg-card p-4 shadow-xl ring-2 ring-brand"
            style={{ animationDelay: "100ms" }}
          >
            <div className="absolute -top-3 left-4 rounded-full bg-brand px-3 py-1 font-mono text-[10px] font-black italic tracking-tighter text-brand-foreground">
              RECOMMENDED #1
            </div>

            <div className="mb-4 flex items-start justify-between">
              <div className="space-y-1">
                <h3 className="text-xl font-black tracking-tight">
                  {TOP_HOSPITAL.name}
                </h3>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span>{TOP_HOSPITAL.address}</span>
                  <span className="h-2 w-px bg-border" />
                  <span className="font-semibold text-brand">{TOP_HOSPITAL.eta}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-black leading-none text-brand">
                  {TOP_HOSPITAL.score}
                </div>
                <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-tighter text-muted-foreground">
                  Match Score
                </div>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2">
              <BedStat
                label="ER Beds"
                tone="green"
                value={TOP_HOSPITAL.beds.er.value}
                total={TOP_HOSPITAL.beds.er.total}
                state="여유"
              />
              <BedStat
                label="ICU"
                tone="neutral"
                value={TOP_HOSPITAL.beds.icu.value}
                total={TOP_HOSPITAL.beds.icu.total}
                state="보통"
              />
              <BedStat
                label="OR"
                tone="neutral"
                value={TOP_HOSPITAL.beds.or.value}
                total={TOP_HOSPITAL.beds.or.total}
                state="가능"
              />
            </div>

            <div className="mb-5 flex flex-wrap gap-1.5">
              {TOP_HOSPITAL.capabilities.map((c) => (
                <span
                  key={c}
                  className="rounded bg-brand/5 px-2 py-1 text-[10px] font-bold text-brand ring-1 ring-brand/10"
                >
                  {c}
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

          {/* Secondary card */}
          <article
            className="animate-entrance rounded-2xl bg-card p-4 ring-1 ring-black/5"
            style={{ animationDelay: "200ms" }}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold tracking-tight">
                  {SECOND_HOSPITAL.name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {SECOND_HOSPITAL.address}
                </p>
              </div>
              <span className="rounded bg-status-amber/10 px-2 py-1 font-mono text-[10px] font-black uppercase text-status-amber">
                CAUTION
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-6">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase text-muted-foreground">
                    ER Status
                  </p>
                  <p className="text-xl font-black text-status-amber">
                    {String(SECOND_HOSPITAL.er).padStart(2, "0")}
                    <span className="text-xs font-normal opacity-50">
                      /{SECOND_HOSPITAL.erTotal}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase text-muted-foreground">
                    Score
                  </p>
                  <p className="text-xl font-black">{SECOND_HOSPITAL.score}</p>
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
          </article>

          {/* Tertiary saturated */}
          <article
            className="animate-entrance rounded-2xl bg-muted/40 p-4 ring-1 ring-black/5"
            style={{ animationDelay: "300ms" }}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-muted-foreground">
                  {THIRD_HOSPITAL.name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {THIRD_HOSPITAL.address}
                </p>
              </div>
              <span className="rounded bg-status-red/10 px-2 py-1 font-mono text-[10px] font-black uppercase text-status-red">
                SATURATED
              </span>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-status-red/15 bg-status-red/5 p-2 text-xs font-medium text-status-red">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{THIRD_HOSPITAL.message}</span>
            </div>
          </article>

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
