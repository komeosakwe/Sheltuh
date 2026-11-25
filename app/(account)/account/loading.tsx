import { SETTINGS_HEAD } from "@/components/account/account-heads";
import AccountPageHead from "@/components/account/AccountPageHead";
import { LoadingState } from "@/components/ui/ProgressLoader";

/** Settings the moment it's opened, as the page first draws itself (AccountContent): the title, then the loader. */
export default function SettingsLoading() {
  return (
    <>
      <AccountPageHead {...SETTINGS_HEAD} />
      <LoadingState text="Loading your account…" />
    </>
  );
}
