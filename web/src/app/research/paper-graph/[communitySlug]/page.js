import { notFound } from "next/navigation";
import {
  getGraphMacros,
  getGraphPublicationsByMacroSlug,
  transformGraphMacroData,
  transformGraphPublicationData,
} from "@/lib/strapi";
import ConstellationClient from "../ConstellationClient";
import { buildMesoTopics } from "../meso";

const MACRO_COLORS = [
  "#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4", "#ffeaa7",
  "#dda0dd", "#98d8c8", "#f7dc6f", "#bb8fce", "#85c1e9",
  "#f8c471", "#82e0aa", "#f1948a", "#aed6f1", "#d5a6bd",
  "#a3e4d7", "#f9e79f", "#d2b4de", "#abebc6", "#fadbd8",
];

const sortMacros = (a, b) => {
  const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : Number.POSITIVE_INFINITY;
  const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return (a.name || "").localeCompare(b.name || "", "en", { sensitivity: "base" });
};

export async function generateMetadata({ params }) {
  const { communitySlug } = await params;
  return { title: `ICIA – ${communitySlug}` };
}

export default async function CommunityTopicsPage({ params }) {
  const { communitySlug: macroSlug } = await params;

  const macrosRaw = await getGraphMacros();
  const macros = transformGraphMacroData(macrosRaw)
    .filter((macro) => macro.isActive !== false)
    .sort(sortMacros);

  const macroIndex = macros.findIndex((macro) => macro.slug === macroSlug);
  if (macroIndex < 0) notFound();
  const macro = macros[macroIndex];

  const publicationsRaw = await getGraphPublicationsByMacroSlug(macroSlug);
  const publications = transformGraphPublicationData(publicationsRaw);

  if (publications.length === 0) notFound();

  const macroLabel = macro?.name || macroSlug;
  const macroColor = MACRO_COLORS[macroIndex % MACRO_COLORS.length];

  const topics = buildMesoTopics(publications);

  return (
    <ConstellationClient
      topics={topics}
      communityLabel={macroLabel}
      communitySlug={macroSlug}
      color={macroColor}
      totalPapers={publications.length}
    />
  );
}
