import { useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";

/**
 * What would have happened, in the demo. A modal like the real "Gespeichert" dialog: on a phone a line of text
 * at the top of the page is out of sight when the tap was further down, and the tap seems to do nothing.
 */
export function DemoNotice({ message, onClose }: { message: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="demo-notice-title"
      onClose={onClose}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded border-2 border-foreground bg-card p-5 backdrop:bg-black/40"
    >
      <h2 id="demo-notice-title" className="pixel text-amber-950">
        Nur Demo
      </h2>
      <p className="mt-2 text-sm">{message}</p>
      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={() => ref.current?.close()}>
          Weiter
        </Button>
      </div>
    </dialog>
  );
}
