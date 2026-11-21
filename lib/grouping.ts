/** Legacy-notes style date sections: Today / Yesterday / This Week / … */
export function groupByRecency<T extends { createdAt: string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  const startOfMonth = new Date(startOfToday);
  startOfMonth.setDate(startOfMonth.getDate() - 30);

  const order = ["Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "Earlier"] as const;
  const buckets: Record<string, T[]> = Object.fromEntries(order.map((label) => [label, []]));

  for (const item of items) {
    const created = new Date(item.createdAt);
    if (created >= startOfToday) buckets.Today.push(item);
    else if (created >= startOfYesterday) buckets.Yesterday.push(item);
    else if (created >= startOfWeek) buckets["Previous 7 Days"].push(item);
    else if (created >= startOfMonth) buckets["Previous 30 Days"].push(item);
    else buckets.Earlier.push(item);
  }

  return order
    .filter((label) => buckets[label].length > 0)
    .map((label) => ({ label, items: buckets[label] }));
}
