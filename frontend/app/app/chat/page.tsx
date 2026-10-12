import { redirect } from "next/navigation";

/** The assistant sits beside the dashboard now rather than on its own page. */
export default function ChatPage() {
  redirect("/app");
}
