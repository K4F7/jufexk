export const LOCATOR_CLICK_GRID = false as const;
export const MOOC_G46_PROBE = { worksheet: "MOOC", address: "G46" } as const;

export type LocatorRole = "course" | "teacher" | "review";
export type LocatorMove = "address_box" | "arrow_right";
export type LocatorClassificationKind =
  | "accepted"
  | "merge_inherit"
  | "stop_return_address_box"
  | "blocked_locator";

export type LocatorClassificationInput = {
  target: string;
  active_addresses: readonly [string, string];
  formula_bar_nonempty: boolean;
  role: LocatorRole;
  worksheet: string;
  move?: LocatorMove;
  origin?: string;
  confirmed_course_anchor?: string;
};

type LocatorClassificationBase = {
  target: string;
  active: string;
  click_grid: false;
  wrote_tencent_or_business_db: false;
};

export type LocatorClassification =
  | { kind: "accepted" } & LocatorClassificationBase
  | { kind: "merge_inherit"; course_anchor: string } & LocatorClassificationBase
  | {
    kind: "stop_return_address_box";
    next_action: "address_box";
  } & LocatorClassificationBase
  | { kind: "blocked_locator"; stay_at_probe: true } & LocatorClassificationBase;

export function classifyLocator(input: LocatorClassificationInput): LocatorClassification {
  if (typeof input.formula_bar_nonempty !== "boolean") {
    throw new Error("formula_bar_nonempty must be a boolean");
  }
  if (!input.worksheet.trim()) throw new Error("worksheet is required");
  if (input.role !== "course" && input.role !== "teacher" && input.role !== "review") {
    throw new Error("invalid locator role");
  }
  const move = input.move ?? "address_box";
  if (move !== "address_box" && move !== "arrow_right") throw new Error("invalid locator move");

  const target = parseAddress(input.target);
  const firstActive = parseAddress(input.active_addresses[0]);
  const secondActive = parseAddress(input.active_addresses[1]);
  const origin = input.origin === undefined ? null : parseAddress(input.origin);
  const confirmedAnchor = input.confirmed_course_anchor === undefined
    ? null
    : parseAddress(input.confirmed_course_anchor);
  const active = secondActive;
  const activesAgree = firstActive.address === secondActive.address;
  const base = {
    target: target.address,
    active: active.address,
    click_grid: LOCATOR_CLICK_GRID,
    wrote_tencent_or_business_db: false as const,
  };

  if (isBlockedMoocG46(input.worksheet, target.address, firstActive.address, secondActive.address)) {
    return { kind: "blocked_locator", stay_at_probe: true, ...base };
  }
  if (activesAgree && firstActive.address === target.address && arrowRightLandsOnNextColumn(move, origin, target)) {
    return { kind: "accepted", ...base };
  }
  if (isCourseAnchorMerge({
    role: input.role,
    move,
    formulaBarNonempty: input.formula_bar_nonempty,
    target,
    firstActive,
    secondActive,
    confirmedAnchor,
  })) {
    return { kind: "merge_inherit", course_anchor: firstActive.address, ...base };
  }
  return { kind: "stop_return_address_box", next_action: "address_box", ...base };
}

function isBlockedMoocG46(worksheet: string, target: string, firstActive: string, secondActive: string) {
  return worksheet === MOOC_G46_PROBE.worksheet
    && target === MOOC_G46_PROBE.address
    && (firstActive !== MOOC_G46_PROBE.address || secondActive !== MOOC_G46_PROBE.address);
}

function arrowRightLandsOnNextColumn(
  move: LocatorMove,
  origin: ReturnType<typeof parseAddress> | null,
  target: ReturnType<typeof parseAddress>,
) {
  if (move !== "arrow_right" || origin === null) return true;
  return nextColumnAddress(origin.address) === target.address;
}

function isCourseAnchorMerge(options: {
  role: LocatorRole;
  move: LocatorMove;
  formulaBarNonempty: boolean;
  target: ReturnType<typeof parseAddress>;
  firstActive: ReturnType<typeof parseAddress>;
  secondActive: ReturnType<typeof parseAddress>;
  confirmedAnchor: ReturnType<typeof parseAddress> | null;
}) {
  if (options.role !== "course" || options.move === "arrow_right" || !options.formulaBarNonempty) return false;
  if (options.firstActive.address !== options.secondActive.address) return false;
  if (options.firstActive.address === options.target.address) return false;
  if (options.firstActive.column !== options.target.column) return false;
  if (options.confirmedAnchor && options.confirmedAnchor.address !== options.firstActive.address) return false;
  return true;
}

function nextColumnAddress(address: string) {
  const parsed = parseAddress(address);
  return `${nextColumn(parsed.column)}${parsed.row}`;
}

function nextColumn(column: string) {
  const chars = [...column];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] !== "Z") {
      chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1);
      return chars.join("");
    }
    chars[index] = "A";
  }
  return `A${chars.join("")}`;
}

function parseAddress(address: string) {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address.trim());
  if (!match) throw new Error(`invalid cell address: ${address}`);
  return { address: `${match[1].toUpperCase()}${match[2]}`, column: match[1].toUpperCase(), row: Number(match[2]) };
}
