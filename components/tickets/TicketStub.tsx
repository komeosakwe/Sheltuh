import LinearBarcode from "@/components/tickets/LinearBarcode";
import UBarcode from "@/components/tickets/UBarcode";

/** One issued ticket: type, code, the straight barcode and the U-shaped one. */
export default function TicketStub({ code, typeName }: { code: string; typeName: string }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-5 border border-foreground p-4">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <p className="eyebrow text-muted">{typeName}</p>
          <p className="mt-1 font-mono text-2xl tracking-widest">{code}</p>
        </div>
        <LinearBarcode code={code} className="h-10 w-full max-w-xs" />
      </div>
      <UBarcode code={code} className="h-28 w-auto sm:h-36" />
    </li>
  );
}
