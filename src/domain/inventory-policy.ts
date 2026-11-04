export interface OnHandCapacityInput {
  confirmedOnHand: number;
  expectedInbound: number;
  proposedQuantity: number;
  maxOnHand: number;
}

/** Expected donations consume physical capacity without becoming available stock. */
export function fitsOnHandCapacity(input: OnHandCapacityInput): boolean {
  return input.confirmedOnHand + input.expectedInbound + input.proposedQuantity <= input.maxOnHand;
}

export function minutesSinceMidnight(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isWithinOperatingHours(input: {
  localTime: string;
  opensAt: string | null;
  closesAt: string | null;
}): boolean {
  const now = minutesSinceMidnight(input.localTime);
  const opens = minutesSinceMidnight(input.opensAt);
  const closes = minutesSinceMidnight(input.closesAt);
  return now !== null && opens !== null && closes !== null && now >= opens && now < closes;
}

/** ETA is a crowd-distribution hint; the donor may arrive before or after it while the point is open. */
export function isAdvisoryDeliveryTimeValid(input: {
  etaMinute: number;
  nowMinute: number;
  opensAtMinute: number;
  closesAtMinute: number;
}) {
  return input.nowMinute < input.closesAtMinute &&
    input.etaMinute >= input.opensAtMinute &&
    input.etaMinute < input.closesAtMinute;
}
