export type ModelRowProps = {
  id: string; context: string; priceIn: string; priceOut: string; score: string;
  checked: boolean; disabled?: boolean; note?: string; onToggle: () => void;
};

export default function ModelRow({ id, context, priceIn, priceOut, score, checked, disabled, note, onToggle }: ModelRowProps) {
  return (
    <li className="model-row">
      <label className="check">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
        <span className="model-id">
          {id}
          <span className="muted show-sm"> {note ?? `${context} ctx · ${priceIn} in · ${priceOut} out`}</span>
        </span>
      </label>
      <span className="num hide-sm">{note ?? context}</span>
      <span className="num hide-sm">{note ? "" : priceIn}</span>
      <span className="num hide-sm">{note ? "" : priceOut}</span>
      <span className="num">{score}</span>
    </li>
  );
}
