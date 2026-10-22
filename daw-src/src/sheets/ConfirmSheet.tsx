import { useState } from "react";
import { useStore } from "../store/store";
import { Sheet } from "./Sheet";
import { answerRequest, confirmQueue, type SheetRequest } from "./confirm";

const ICON_PATHS: Record<SheetRequest["icon"], string> = {
  warn: "M12 4l9 16H3zM12 10v4M12 17.5v.5",
  danger: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  info: "M12 8v.5M12 11v6M12 3a9 9 0 100 18 9 9 0 000-18z",
};

function Question({ request }: { request: SheetRequest }) {
  const [text, setText] = useState(request.field?.initial ?? "");
  const [error, setError] = useState<string | null>(null);

  const answer = (choice: string): void => {
    if (request.field) {
      const problem = request.field.validate ? request.field.validate(text) : null;
      if (problem) {
        setError(problem);
        return;
      }
    }
    answerRequest(request.id, { choice, text });
  };

  return (
    <Sheet title={request.title} width={520} hideHead onClose={() => answerRequest(request.id, null)}>
      <div className={`confirm-icon ${request.icon}`}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={ICON_PATHS[request.icon]} />
        </svg>
      </div>
      <p className="confirm-title" aria-hidden="true">
        {request.title}
      </p>
      {request.message && <p className="confirm-message">{request.message}</p>}
      {request.field && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            answer(request.choices[0].id);
          }}
        >
          <label className="field-label" htmlFor={`prompt-${request.id}`}>
            {request.field.label}
          </label>
          <input
            id={`prompt-${request.id}`}
            data-autofocus
            type="text"
            value={text}
            placeholder={request.field.placeholder}
            aria-invalid={error !== null}
            aria-describedby={error ? `prompt-error-${request.id}` : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
          />
          {error && (
            <p id={`prompt-error-${request.id}`} className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      <div className="confirm-actions">
        {request.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={`btn btn-${choice.tone === "danger" ? "danger" : choice.tone === "secondary" ? "ghost" : "primary"}`}
            onClick={() => answer(choice.id)}
          >
            {choice.label}
          </button>
        ))}
        <button type="button" className="btn btn-cancel" onClick={() => answerRequest(request.id, null)}>
          {request.cancelLabel}
        </button>
      </div>
    </Sheet>
  );
}

export function ConfirmSheet() {
  const request = useStore(confirmQueue, (q) => q.requests[0]);
  if (!request) return null;
  return <Question key={request.id} request={request} />;
}
