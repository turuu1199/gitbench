export function Diff({ text }: { text: string }) {
  if (!text) return <div className="empty">No changes to show</div>;
  return (
    <pre className="diff">
      {text.split("\n").map((line, i) => {
        let cls = "";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "meta";
        else if (line.startsWith("+")) cls = "add";
        else if (line.startsWith("-")) cls = "del";
        else if (line.startsWith("@@")) cls = "hunk";
        else if (/^(diff |index |commit |Author:|Date:)/.test(line)) cls = "meta";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
