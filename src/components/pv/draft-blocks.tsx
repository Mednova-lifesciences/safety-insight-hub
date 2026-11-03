import type { Block, BlockOrigin } from "@/services/psur/draft/content";
import { cn } from "@/lib/utils";

const ORIGIN_LABEL: Partial<Record<BlockOrigin, string>> = {
  RECORDS: "From records",
  AUTHOR: "Author",
  NA: "Not applicable",
  AID: "Author aid — working draft only",
};

const ORIGIN_STYLE: Record<BlockOrigin, string> = {
  RECORDS: "border-l-2 border-info/60 pl-3",
  AUTHOR: "border-l-2 border-success/60 pl-3",
  PLACEHOLDER: "rounded border border-warning/40 bg-warning-soft px-2 py-1 text-warning",
  NA: "border-l-2 border-border pl-3 italic",
  AID: "rounded border border-dashed border-border px-2 py-1 text-muted-foreground",
  FIXED: "",
};

function Tag({ origin }: { origin: BlockOrigin }) {
  const label = ORIGIN_LABEL[origin];
  return label ? (
    <span className="ml-2 align-middle text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
      {label}
    </span>
  ) : null;
}

/** The section exactly as it will print, with where each part comes from. */
export function DraftBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-2.5 text-sm">
      {blocks.map((b, i) => {
        if (b.kind === "subheading")
          return (
            <p key={i} className="pt-1 font-semibold">
              {b.text}
            </p>
          );
        if (b.kind === "para")
          return (
            <p key={i} className={cn("whitespace-pre-wrap", ORIGIN_STYLE[b.origin])}>
              {b.text}
              <Tag origin={b.origin} />
            </p>
          );
        if (b.kind === "field")
          return (
            <div
              key={i}
              className={cn("grid gap-1 sm:grid-cols-[14rem_1fr]", ORIGIN_STYLE[b.origin])}
            >
              <span className="text-muted-foreground">{b.label}</span>
              <span className="whitespace-pre-wrap">
                {b.value}
                <Tag origin={b.origin} />
              </span>
            </div>
          );
        return (
          <div key={i} className={cn("space-y-1", ORIGIN_STYLE[b.origin])}>
            <p className="text-xs font-medium">
              {b.caption}
              <Tag origin={b.origin} />
            </p>
            {b.rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rows.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {b.headers.map((h) => (
                        <th key={h} className="px-2 py-1 font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="border-b border-border last:border-0">
                        {r.map((c, k) => (
                          <td key={k} className="px-2 py-1 align-top">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {b.note ? <p className="text-[11px] text-muted-foreground">{b.note}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
