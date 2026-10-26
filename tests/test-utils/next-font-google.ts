/**
 * `next/font/google` under vitest (vitest.config.mts aliases it here). The
 * real loaders exist only inside Next's compiler: the package's runtime
 * module is empty, so a component that loads a font (OAuthButtons' Roboto)
 * couldn't be imported in a test without this. Add a loader here when a
 * component under test starts using another one.
 */
interface FontOptions {
  variable?: string;
}

function stubFont(family: string, { variable }: FontOptions) {
  const slug = family.toLowerCase().replace(/\W+/g, "-");
  return {
    className: `font-${slug}`,
    variable: variable ? `font-${slug}-variable` : "",
    style: { fontFamily: family },
  };
}

export function Roboto(options: FontOptions = {}) {
  return stubFont("Roboto", options);
}
