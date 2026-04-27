import { slugify } from "@/lib/slug";

const DEFAULT_MIN_NODE_PAPERS = 3;
const DEFAULT_MAX_NODES = 20;
const DEFAULT_MIN_NODES = 8;

const toIntEnv = (value, fallback) => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MESO_MIN_NODE_PAPERS = toIntEnv(process.env.GRAPH_MESO_MIN_NODE_PAPERS, DEFAULT_MIN_NODE_PAPERS);
const MESO_MAX_NODES = toIntEnv(process.env.GRAPH_MESO_MAX_NODES, DEFAULT_MAX_NODES);
const MESO_MIN_NODES = toIntEnv(process.env.GRAPH_MESO_MIN_NODES, DEFAULT_MIN_NODES);

const normalizeTopicFallback = (publication) => {
  const topic = publication.topics?.[0] || "Other";
  const key = `topic-${slugify(topic) || "other"}`;
  return {
    key,
    label: topic,
    allKeys: [key],
  };
};

export function getPublicationMesoMembership(publication) {
  const topicSuperclusters = publication.topicSuperclusters;
  const ids = Array.isArray(topicSuperclusters?.ids)
    ? topicSuperclusters.ids.filter((value) => Number.isInteger(value))
    : [];
  const labels = Array.isArray(topicSuperclusters?.labels)
    ? topicSuperclusters.labels.filter(Boolean).map((value) => String(value))
    : [];

  if (!ids.length) {
    return normalizeTopicFallback(publication);
  }

  const primaryId = Number.isInteger(topicSuperclusters?.primaryId)
    ? topicSuperclusters.primaryId
    : ids[0];
  const primaryLabel =
    typeof topicSuperclusters?.primaryLabel === "string" && topicSuperclusters.primaryLabel.trim()
      ? topicSuperclusters.primaryLabel.trim()
      : labels[0] || `Topic Group ${primaryId}`;

  const allKeys = ids.map((clusterId) => `sc-${clusterId}`);
  return {
    key: `sc-${primaryId}`,
    label: primaryLabel,
    allKeys,
  };
}

function buildNode(publication, membership) {
  const years = publication.year ? [publication.year] : [];
  return {
    key: membership.key,
    label: membership.label,
    memberKeys: [membership.key],
    paperCount: 1,
    years,
  };
}

function mergeNodes(nodes) {
  const paperCount = nodes.reduce((sum, node) => sum + node.paperCount, 0);
  const years = nodes.flatMap((node) => node.years);
  const memberKeys = nodes.flatMap((node) => node.memberKeys);
  return {
    key: "other-themes",
    label: "Other Themes",
    memberKeys,
    paperCount,
    years,
  };
}

export function buildMesoTopics(publications, options = {}) {
  const minNodePapers = toIntEnv(options.minNodePapers, MESO_MIN_NODE_PAPERS);
  const maxNodes = toIntEnv(options.maxNodes, MESO_MAX_NODES);
  const minNodes = toIntEnv(options.minNodes, MESO_MIN_NODES);

  const nodeMap = {};
  publications.forEach((publication) => {
    const membership = getPublicationMesoMembership(publication);
    const existing = nodeMap[membership.key];
    if (!existing) {
      nodeMap[membership.key] = buildNode(publication, membership);
      return;
    }

    existing.paperCount += 1;
    if (publication.year) existing.years.push(publication.year);
  });

  let nodes = Object.values(nodeMap).sort((a, b) => b.paperCount - a.paperCount);
  if (!nodes.length) return [];

  let kept = [];
  let merged = [];

  nodes.forEach((node) => {
    if (node.paperCount >= minNodePapers) {
      kept.push(node);
    } else {
      merged.push(node);
    }
  });

  while (kept.length < minNodes && merged.length > 0) {
    kept.push(merged.shift());
  }

  kept = kept.sort((a, b) => b.paperCount - a.paperCount);
  if (kept.length > maxNodes - 1) {
    merged.push(...kept.slice(maxNodes - 1));
    kept = kept.slice(0, maxNodes - 1);
  }

  const finalNodes = [...kept];
  if (merged.length > 0) {
    finalNodes.push(mergeNodes(merged));
  }

  return finalNodes
    .sort((a, b) => b.paperCount - a.paperCount)
    .map((node) => {
      const yearMin = node.years.length ? Math.min(...node.years) : null;
      const yearMax = node.years.length ? Math.max(...node.years) : null;
      const slugBase = node.key === "other-themes" ? "other-themes" : node.key;
      return {
        ...node,
        slug: slugify(slugBase) || "other-themes",
        yearRange: yearMin
          ? yearMin === yearMax
            ? `${yearMin}`
            : `${yearMin}-${yearMax}`
          : null,
      };
    });
}

export function filterPublicationsForMesoTopic(publications, topicNode) {
  if (!topicNode) return [];

  const memberKeys = new Set(topicNode.memberKeys || []);
  return publications.filter((publication) => {
    const membership = getPublicationMesoMembership(publication);
    if (memberKeys.has(membership.key)) {
      return true;
    }

    return membership.allKeys.some((key) => memberKeys.has(key));
  });
}
