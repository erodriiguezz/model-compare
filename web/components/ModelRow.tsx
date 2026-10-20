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
          {note ? <span className="muted"> {note}</span> : <span className="muted show-sm"> {context} ctx · {priceIn} in · {priceOut} out</span>}
        </span>
      </label>
      <span className="num hide-sm">{context}</span>
      <span className="num hide-sm">{priceIn}</span>
      <span className="num hide-sm">{priceOut}</span>
      <span className="num">{score}</span>
    </li>
  );
}
