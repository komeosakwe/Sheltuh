/** §5.A12: the door's standing advice, one tap away. */
export default function HowCheckInWorks() {
  return (
    <details>
      <summary className="eyebrow inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
        How check-in works
      </summary>
      <ul className="mt-2 flex flex-col gap-2 text-sm text-muted">
        <li>Each ticket gets in once. A second scan shows Already checked in, with the time of the first.</li>
        <li>Not verified means nothing was checked. Don&rsquo;t let anyone in on that scan: retry, or type the code.</li>
        <li>
          Use Undo in Recent scans if you checked in the wrong ticket, or Undo check-in on an Already checked in
          result to let someone back in. You&rsquo;ll need a reason.
        </li>
        <li>Use the torch for paper tickets. Turn it off for phone screens: it causes glare.</li>
        <li>Everyone on the door signs in with this organiser account.</li>
      </ul>
    </details>
  );
}
