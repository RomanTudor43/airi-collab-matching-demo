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

export function getPublicationMesoMembership(publication) {
  const mesoTags = Array.isArray(publication.graphMesoTags) ? publication.graphMesoTags : [];
  const mesoPrimary = publication.graphMesoPrimary || null;

  // If no tags and no explicit primary, nothing to do.
  if (!mesoTags.length && !mesoPrimary) return null;

  // Prefer an explicit primary meso relation when available; fall back to first tag.
  const primary = mesoPrimary || mesoTags[0] || {};
  const primaryKey = primary.slug || (primary.id != null ? `meso-${primary.id}` : "");
  const primaryLabel = primary.name || primary.slug || "Meso";

  const allKeys = (mesoTags || [])
    .map((tag) => tag.slug || (tag.id != null ? `meso-${tag.id}` : ""))
    .filter(Boolean);

  if (!primaryKey || !allKeys.length) {
    return null;
  }
  return {
    key: primaryKey,
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
    if (!membership) {
      return;
    }
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
    if (!membership) return false;
    if (memberKeys.has(membership.key)) {
      return true;
    }

    return membership.allKeys.some((key) => memberKeys.has(key));
  });
}

export function buildMesoLinks(publications, links, topics) {
  if (!Array.isArray(topics) || topics.length === 0) return [];

  const memberKeyToNode = {};
  topics.forEach((node) => {
    const keys = Array.isArray(node.memberKeys) && node.memberKeys.length ? node.memberKeys : [node.key];
    keys.filter(Boolean).forEach((key) => {
      memberKeyToNode[key] = node.key;
    });
  });

  const publicationToNode = {};
  publications.forEach((publication) => {
    const membership = getPublicationMesoMembership(publication);
    if (!membership) return;
    let nodeKey = memberKeyToNode[membership.key];
    if (!nodeKey && Array.isArray(membership.allKeys)) {
      for (const key of membership.allKeys) {
        if (memberKeyToNode[key]) {
          nodeKey = memberKeyToNode[key];
          break;
        }
      }
    }
    if (nodeKey) publicationToNode[publication.id] = nodeKey;
  });

  const edgeMap = {};
  links.forEach((link) => {
    const sourceKey = publicationToNode[link.sourceId];
    const targetKey = publicationToNode[link.targetId];
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    const ordered = sourceKey < targetKey ? [sourceKey, targetKey] : [targetKey, sourceKey];
    const edgeKey = `${ordered[0]}::${ordered[1]}`;
    if (!edgeMap[edgeKey]) {
      edgeMap[edgeKey] = {
        sourceKey: ordered[0],
        targetKey: ordered[1],
        count: 0,
        scoreSum: 0,
      };
    }
    edgeMap[edgeKey].count += 1;
    edgeMap[edgeKey].scoreSum += Number.isFinite(link.score) ? link.score : 0;
  });

  const edges = Object.values(edgeMap);
  if (!edges.length) return [];

  const maxCount = edges.reduce((max, edge) => Math.max(max, edge.count), 0);
  return edges
    .map((edge) => ({
      ...edge,
      avgScore: edge.count > 0 ? edge.scoreSum / edge.count : 0,
      strength: maxCount > 0 ? edge.count / maxCount : 0,
    }))
    .sort((a, b) => b.count - a.count);
}
