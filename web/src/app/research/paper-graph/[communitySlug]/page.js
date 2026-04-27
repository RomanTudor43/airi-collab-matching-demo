import { notFound } from "next/navigation";
import { getGraphPublicationsByCommunity, transformGraphPublicationData } from "@/lib/strapi";
import ConstellationClient from "../ConstellationClient";
import { buildMesoTopics } from "../meso";

const COMMUNITY_COLORS = [
  "#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4", "#ffeaa7",
  "#dda0dd", "#98d8c8", "#f7dc6f", "#bb8fce", "#85c1e9",
  "#f8c471", "#82e0aa", "#f1948a", "#aed6f1", "#d5a6bd",
  "#a3e4d7", "#f9e79f", "#d2b4de", "#abebc6", "#fadbd8",
];

export async function generateMetadata({ params }) {
  const { communitySlug } = await params;
  return { title: `ICIA – Community ${communitySlug}` };
}

export default async function CommunityTopicsPage({ params }) {
  const { communitySlug } = await params;

  const match = communitySlug.match(/^c-(\d+)$/);
  if (!match) notFound();
  const communityId = parseInt(match[1], 10);

  const publicationsRaw = await getGraphPublicationsByCommunity(communityId);
  const publications = transformGraphPublicationData(publicationsRaw);

  if (publications.length === 0) notFound();

  const communityLabel =
    publications.find((p) => p.communityLabel)?.communityLabel ||
    `Community ${communityId}`;

  const commColor = COMMUNITY_COLORS[communityId % COMMUNITY_COLORS.length];

  const topics = buildMesoTopics(publications);

  return (
    <ConstellationClient
      topics={topics}
      communityLabel={communityLabel}
      communitySlug={communitySlug}
      color={commColor}
      totalPapers={publications.length}
    />
  );
}
