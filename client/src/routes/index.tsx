import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The editor reads the JWT from localStorage and drives a canvas, so it only renders in the browser.
const Editor = lazy(() => import("@/components/bmap/Editor"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BMap — карта рынка" },
      {
        name: "description",
        content:
          "BMap: визуальный редактор карты рынка — процессы, участники, ресурсы и логистика в одном графе.",
      },
      { property: "og:title", content: "BMap — карта рынка" },
      {
        property: "og:description",
        content: "Стройте и редактируйте иерархическую карту рынка в виде графа.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-canvas">
      <div className="font-display text-lg font-semibold text-muted-foreground">BMap</div>
    </div>
  );
}

function Index() {
  return (
    <ClientOnly fallback={<Splash />}>
      <Suspense fallback={<Splash />}>
        <Editor />
      </Suspense>
    </ClientOnly>
  );
}
