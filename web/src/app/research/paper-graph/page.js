export const metadata = {
  title: "ICIA – Research Graph",
};

import {
  getGraphPublications,
  getGraphLinks,
  transformGraphPublicationData,
  transformGraphLinkData,
} from "@/lib/strapi";
import GalaxyClient from "./GalaxyClient";

const COMMUNITY_COLORS = [
  "#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4", "#ffeaa7",
  "#dda0dd", "#98d8c8", "#f7dc6f", "#bb8fce", "#85c1e9",
  "#f8c471", "#82e0aa", "#f1948a", "#aed6f1", "#d5a6bd",
  "#a3e4d7", "#f9e79f", "#d2b4de", "#abebc6", "#fadbd8",
];

export default async function PaperGraphPage() {
  const publicationsRaw = await getGraphPublications();
  const publications = transformGraphPublicationData(publicationsRaw);

  // Build community index
  const communityMap = {};
  publications.forEach((p) => {
    if (p.community == null) return;
    if (!communityMap[p.community]) {
      communityMap[p.community] = {
        id: p.community,
        label: p.communityLabel || `Cluster ${p.community}`,
        paperCount: 0,
        topicCounts: {},
      };
    }
    communityMap[p.community].paperCount += 1;
    (p.topics || []).forEach((t) => {
      communityMap[p.community].topicCounts[t] =
        (communityMap[p.community].topicCounts[t] || 0) + 1;
    });
  });

  const communities = Object.values(communityMap)
    .sort((a, b) => b.paperCount - a.paperCount)
    .map((comm, ci) => ({
      ...comm,
      color: COMMUNITY_COLORS[ci % COMMUNITY_COLORS.length],
      topTopics: Object.entries(comm.topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t),
    }));

  // Build publication lookups
  const oaToIdMap = {};
  const publicationById = {};
  publications.forEach((p) => {
    if (p.openAlexId) oaToIdMap[p.openAlexId] = p.id;
    publicationById[p.id] = p;
  });
  
  const linksRaw = await getGraphLinks();
  const links = transformGraphLinkData(linksRaw, oaToIdMap);
  
  const publicationComm = {};
  publications.forEach((p) => { if (p.community != null) publicationComm[p.id] = p.community; });
  
  // Build inter-community link summary (cluster-to-cluster counts)
  const bridgeMap = {};
  links.forEach((l) => {
    const sc = publicationComm[l.sourceId];
    const tc = publicationComm[l.targetId];
    if (sc == null || tc == null || sc === tc) return;
    const key = sc < tc ? `${sc}-${tc}` : `${tc}-${sc}`;
    if (!bridgeMap[key]) bridgeMap[key] = { source: Math.min(sc, tc), target: Math.max(sc, tc), count: 0 };
    bridgeMap[key].count += 1;
  });
  const interLinks = Object.values(bridgeMap);
  
  // Debug log for cross-cluster links
  console.log(`[paper-graph] ${links.length} total links, ${interLinks.length} cluster bridges`);
  if (interLinks.length > 0) {
    console.log(`[paper-graph] Bridge sample:`, interLinks.slice(0, 3).map(l => `c${l.source}↔c${l.target}:${l.count}`).join(', '));
  }

  // Build publication-level cross-cluster links for hover preview
  // Group by cluster pair, limit to top links per pair
  const crossClusterLinks = links
    .filter((l) => {
      const sc = publicationComm[l.sourceId];
      const tc = publicationComm[l.targetId];
      return sc != null && tc != null && sc !== tc;
    })
    .map((l) => {
      const sourcePublication = publicationById[l.sourceId];
      const targetPublication = publicationById[l.targetId];
      return {
        sourceId: l.sourceId,
        targetId: l.targetId,
        sourceTitle: sourcePublication?.title || 'Unknown',
        targetTitle: targetPublication?.title || 'Unknown',
        sourceCluster: publicationComm[l.sourceId],
        targetCluster: publicationComm[l.targetId],
        score: l.score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 200); // Limit for performance

  if (communities.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "#03070f" }}>
        <div className="font-mono text-amber-500/40 text-sm">
          No community data yet. Run the paper-sync script to generate clusters.
        </div>
      </main>
    );
  }

  return (
    <GalaxyClient
      communities={communities}
      interLinks={interLinks}
      crossClusterLinks={crossClusterLinks}
      totalPapers={publications.length}
    />
  );
}


