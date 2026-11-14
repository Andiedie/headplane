import { Form } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import Link from "~/components/link";
import { Trans, useI18n } from "~/i18n/react";
import Shell from "~/routes/auth/login/shell";

import { SSH_DOCS_URL } from "./errors";

interface UserPromptProps {
  hostname: string;
}

export default function UserPrompt({ hostname }: UserPromptProps) {
  const { t } = useI18n();
  return (
    <Shell description={t("ssh.prompt.description")} title={t("ssh.prompt.title", { hostname })}>
      <Form
        className="flex flex-col gap-3"
        method="GET"
        onSubmit={(e) => {
          const formData = new FormData(e.currentTarget);
          const username = formData.get("user");
          if (!username) {
            e.preventDefault();
            return;
          }

          // The page needs a full reload to start the SSH connection, since
          // revalidation is disabled for this route.
          e.preventDefault();
          const url = new URL(window.location.href);
          url.searchParams.set("user", username.toString());
          window.location.assign(url.toString());
        }}
      >
        <Input
          autoComplete="off"
          label={t("ssh.prompt.username")}
          name="user"
          required
          spellCheck={false}
        />
        <Button className="w-full" type="submit" variant="primary">
          {t("ssh.prompt.connect")}
        </Button>
      </Form>
      <p className="text-muted mt-6 text-sm">
        <Trans
          id="ssh.prompt.help"
          values={{
            link: (
              <Link external styled to={`${SSH_DOCS_URL}#troubleshooting`}>
                {t("ssh.prompt.troubleshooting")}
              </Link>
            ),
          }}
        />
      </p>
    </Shell>
  );
}
