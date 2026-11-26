import { SAVED_HEAD } from "@/components/account/account-heads";
import AccountPageHead from "@/components/account/AccountPageHead";
import { LoadingState } from "@/components/ui/ProgressLoader";

/** Saved the moment it's opened, as the page first draws itself (SavedPageContent): the title, then the loader. */
export default function SavedLoading() {
  return (
    <>
      <AccountPageHead {...SAVED_HEAD} />
      <LoadingState text="Loading…" />
    </>
  );
}
