"use client";

import { FailureNotice } from "@/components/app/failure-notice";
import { RuleEditor } from "@/components/app/rule-editor";
import { ScheduleScreen } from "@/components/app/schedule-screen";
import { ActionButton, Card, CardTitle, Note, StatusDot } from "@/components/app/ui";
import { en } from "@/content/en";
import { useGuardAction, useSelectedPosition } from "@/lib/platform/provider";

/**
 * The rule page: the editor, the schedule beside it, and the one repair card.
 *
 * Authorization is not a separate screen any more. Granting it is what saving
 * the first rule does, so the two lived on one page or the user set numbers in
 * one place and signed them in another.
 */

const copy = en.app.authorize;

function StrandedCard({ obligation }: { obligation: string }) {
  const migrate = useGuardAction((source) => source.migrateGuard({ obligation }));

  return (
    <Card>
      <CardTitle>
        <StatusDot tone="warn" /> {copy.strandedHeading}
      </CardTitle>
      <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-ink-dim">{copy.strandedBody}</p>
      <ActionButton
        className="mt-4"
        variant="primary"
        busy={migrate.isPending}
        onClick={() => migrate.mutate()}
      >
        {copy.strandedCta}
      </ActionButton>
      <Note className="mt-3 max-w-[70ch]">{copy.strandedNote}</Note>
      {migrate.data && !migrate.data.ok ? (
        <FailureNotice className="mt-3" failure={migrate.data.failure} />
      ) : null}
      {migrate.data?.ok ? <p className="mt-3 text-[13px] text-state-ok">{copy.strandedDone}</p> : null}
    </Card>
  );
}

export function RuleScreen() {
  const { entry } = useSelectedPosition();
  const stranded = entry?.guardNeedsMigration === true;

  return (
    <div className="flex flex-col gap-6">
      {stranded && entry ? <StrandedCard obligation={entry.position.obligation} /> : null}
      <RuleEditor />
      <ScheduleScreen />
    </div>
  );
}
