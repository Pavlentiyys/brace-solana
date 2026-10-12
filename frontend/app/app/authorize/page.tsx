import { redirect } from "next/navigation";

/** Authorization is granted from the rule editor. Old links still land. */
export default function AuthorizePage() {
  redirect("/app/rule");
}
