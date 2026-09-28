import { UsageError } from "../errors";

export interface SelectorQuery {
  ref?: string;
  resourceId?: string;
  contentDesc?: string;
  descContains?: string;
  text?: string;
  textContains?: string;
  className?: string;
  bounds?: { x1: number; y1: number; x2: number; y2: number };
}

export function parseSelectorArgs(args: Record<string, unknown>): SelectorQuery {
  const query: SelectorQuery = {};

  if (args.ref !== undefined && args.ref !== null && String(args.ref).trim()) {
    let refVal = String(args.ref).trim();
    if (!refVal.startsWith("@")) {
      refVal = "@" + refVal;
    }
    query.ref = refVal;
  }
  if (typeof args.resource_id === "string" && args.resource_id.trim()) {
    query.resourceId = args.resource_id.trim();
  }
  if (typeof args.resourceId === "string" && args.resourceId.trim()) {
    query.resourceId = args.resourceId.trim();
  }
  if (typeof args.description === "string" && args.description.trim()) {
    query.contentDesc = args.description.trim();
  }
  if (typeof args.content_desc === "string" && args.content_desc.trim()) {
    query.contentDesc = args.content_desc.trim();
  }
  if (typeof args.desc_contains === "string" && args.desc_contains.trim()) {
    query.descContains = args.desc_contains.trim();
  }
  if (typeof args.descContains === "string" && args.descContains.trim()) {
    query.descContains = args.descContains.trim();
  }
  if (typeof args.text === "string" && args.text.trim()) {
    query.text = args.text.trim();
  }
  if (typeof args.text_contains === "string" && args.text_contains.trim()) {
    query.textContains = args.text_contains.trim();
  }
  if (typeof args.textContains === "string" && args.textContains.trim()) {
    query.textContains = args.textContains.trim();
  }
  if (typeof args.class_name === "string" && args.class_name.trim()) {
    query.className = args.class_name.trim();
  }
  if (typeof args.className === "string" && args.className.trim()) {
    query.className = args.className.trim();
  }

  if (typeof args.bounds === "string" && args.bounds.trim()) {
    const rect = parseBoundsRect(args.bounds.trim());
    if (!rect) {
      throw new UsageError(`Invalid bounds format: '${args.bounds}'. Expected '[x1,y1][x2,y2]' or 'x1,y1,x2,y2'`);
    }
    query.bounds = rect;
  }

  if (
    !query.ref &&
    !query.resourceId &&
    !query.contentDesc &&
    !query.descContains &&
    !query.text &&
    !query.textContains &&
    !query.className &&
    !query.bounds
  ) {
    throw new UsageError("Must specify at least one selector criteria (--ref, --text, --resource-id, --description, --bounds)");
  }

  return query;
}

export function parseBoundsRect(boundsStr: string): { x1: number; y1: number; x2: number; y2: number } | null {
  // Format 1: [270,1754][450,2058]
  const matchBracket = boundsStr.match(/^\[(\d+),\s*(\d+)\]\[(\d+),\s*(\d+)\]$/);
  if (matchBracket) {
    return {
      x1: parseInt(matchBracket[1], 10),
      y1: parseInt(matchBracket[2], 10),
      x2: parseInt(matchBracket[3], 10),
      y2: parseInt(matchBracket[4], 10),
    };
  }

  // Format 2: 270,1754,450,2058 or 270,1754-450,2058
  const matchComma = boundsStr.match(/^(\d+)[\s,]+(\d+)[\s,\-]+(\d+)[\s,]+(\d+)$/);
  if (matchComma) {
    return {
      x1: parseInt(matchComma[1], 10),
      y1: parseInt(matchComma[2], 10),
      x2: parseInt(matchComma[3], 10),
      y2: parseInt(matchComma[4], 10),
    };
  }

  return null;
}
