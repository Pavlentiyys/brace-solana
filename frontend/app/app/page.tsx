import { Chat } from "@/components/chat/chat";
import { PageHeading } from "@/components/app/ui";
import { en } from "@/content/en";

/**
 * The app is a conversation now.
 *
 * The screens it used to be are still here and still own their own correctness; they
 * are what the bot answers with. `/app/reserve` and `/app/history` remain as direct
 * routes because a link somebody bookmarked should keep working, and because the
 * chat is a way through the product rather than the only door.
 */
export default function AppHome() {
  return (
    // The conversation stays the 76ch it has always been; the container grows by
    // exactly the rail beside it (220px) plus the gap (md:gap-8 = 32px), so adding
    // the chat list took no width away from the reading column.
    <div className="mx-auto w-full max-w-[76ch] md:max-w-[calc(76ch+252px)]">
      <PageHeading title={en.app.chat.heading} lead={en.app.chat.lead} />
      <div className="mt-8">
        <Chat />
      </div>
    </div>
  );
}
