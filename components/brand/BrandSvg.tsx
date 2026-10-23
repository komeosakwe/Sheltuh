import type { SVGProps } from "react";
import type { BrandMark } from "./marks";

export type BrandSvgProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "children" | "role"> & {
  /**
   * The accessible name. Without it the mark is decorative (aria-hidden) and
   * the name belongs on its parent, e.g. the nav link's "Sheltüh home".
   */
  label?: string;
};

/**
 * Renders one official brand vector in currentColor. The width and height
 * attributes are the viewBox's, so sizing one side in CSS (`h-5 w-auto`,
 * `w-full h-auto`) keeps the mark's proportions: never stretch it.
 */
export default function BrandSvg({
  mark,
  label,
  pathTransforms,
  ...props
}: BrandSvgProps & {
  mark: BrandMark;
  /** An SVG `transform` per path, in the mark's user units (DotsMark's "joined"). */
  pathTransforms?: readonly (string | undefined)[];
}) {
  const [, , width, height] = mark.viewBox.split(" ");
  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true, focusable: "false" } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={mark.viewBox}
      width={width}
      height={height}
      fill="currentColor"
      {...a11y}
      {...props}
    >
      {mark.paths.map((d, index) => (
        <path key={index} d={d} transform={pathTransforms?.[index]} />
      ))}
    </svg>
  );
}
