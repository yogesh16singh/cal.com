import type { GetServerSidePropsContext } from "next";
import { signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";
import { FormProvider, SubmitHandler, useForm } from "react-hook-form";

import LicenseRequired from "@calcom/features/ee/common/components/v2/LicenseRequired";
import { isSAMLLoginEnabled } from "@calcom/features/ee/sso/lib/saml";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { collectPageParameters, telemetryEventTypes, useTelemetry } from "@calcom/lib/telemetry";
import { inferSSRProps } from "@calcom/types/inferSSRProps";
import { Alert, Button, EmailField, PasswordField, TextField } from "@calcom/ui";
import { HeadSeo } from "@calcom/web/components/seo/head-seo";
import { asStringOrNull } from "@calcom/web/lib/asStringOrNull";
import { WEBAPP_URL } from "@calcom/web/lib/config/constants";
import prisma from "@calcom/web/lib/prisma";
import { IS_GOOGLE_LOGIN_ENABLED } from "@calcom/web/server/lib/constants";
import { ssrInit } from "@calcom/web/server/lib/ssr";

type FormValues = {
  username: string;
  email: string;
  password: string;
  passwordcheck: string;
  apiError: string;
};

export default function Signup({ prepopulateFormValues }: inferSSRProps<typeof getServerSideProps>) {
  const { t } = useLocale();
  const router = useRouter();
  const telemetry = useTelemetry();

  const [isFirstTry, setIsFirstTry] = useState(true);
  const [emailInvalidMessage, setEmailInvalidMessage] = useState("");

  const methods = useForm<FormValues>({
    defaultValues: prepopulateFormValues,
  });
  const {
    register,
    formState: { errors, isSubmitting },
  } = methods;

  const handleErrors = async (resp: Response) => {
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.message);
    }
  };

  const signUp: SubmitHandler<FormValues> = async (data) => {
    let isValid = true;

    await fetch("/api/auth/verifyEmail", {
      body: JSON.stringify({ email: data.email }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
      .then((response) => response.json())
      .then((result) => {
        setEmailInvalidMessage("");
        const { verdict, suggestion } = result;
        if (verdict === "Valid") {
          setEmailInvalidMessage("");
        } else if (isFirstTry) {
          setIsFirstTry(false);
          isValid = false;
          if (suggestion) {
            setEmailInvalidMessage(`Did you mean ${suggestion}?`);
          } else {
            setEmailInvalidMessage("Please double check your email address");
          }
        }
      })
      .catch((error) => {
        console.error("Error:", error);
      });

    if (isValid) {
      await fetch("/api/auth/signup", {
        body: JSON.stringify({
          ...data,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      })
        .then(handleErrors)
        .then(async () => {
          telemetry.event(telemetryEventTypes.login, collectPageParameters());
          await signIn<"credentials">("credentials", {
            ...data,
            callbackUrl: router.query.callbackUrl
              ? `${WEBAPP_URL}/${router.query.callbackUrl}`
              : `${WEBAPP_URL}/getting-started`,
          });
        })
        .catch((err) => {
          methods.setError("apiError", { message: err.message });
        });
    }
  };

  return (
    <LicenseRequired>
      <div
        className="flex min-h-screen flex-col justify-center bg-gray-50 py-12 sm:px-6 lg:px-8"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true">
        <HeadSeo title={t("sign_up")} description={t("sign_up")} />
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="font-cal text-center text-3xl font-extrabold text-gray-900">
            {t("create_your_account")}
          </h2>
        </div>
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="mx-2 bg-white px-4 py-8 shadow sm:rounded-lg sm:px-10">
            <FormProvider {...methods}>
              <form onSubmit={methods.handleSubmit(signUp)} className="space-y-6 bg-white">
                {errors.apiError && <Alert severity="error" message={errors.apiError?.message} />}
                <div className="space-y-2">
                  <TextField
                    addOnLeading={`${process.env.NEXT_PUBLIC_WEBSITE_URL}/`}
                    {...register("username")}
                    required
                  />
                  <div>
                    <EmailField {...register("email")} />
                    <p className="mb-1 -mt-1 text-sm text-red-700">{emailInvalidMessage}</p>
                  </div>
                  <PasswordField
                    labelProps={{
                      className: "block text-sm font-medium text-gray-700",
                    }}
                    {...register("password")}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-black focus:outline-none focus:ring-black sm:text-sm"
                  />
                  <PasswordField
                    label={t("confirm_password")}
                    {...register("passwordcheck", {
                      validate: (value) =>
                        value === methods.watch("password") || (t("error_password_mismatch") as string),
                    })}
                  />
                </div>
                <div className="flex space-x-2 rtl:space-x-reverse">
                  <Button type="submit" loading={isSubmitting} className="w-7/12 justify-center">
                    {t("create_account")}
                  </Button>
                  <Button
                    color="secondary"
                    className="w-5/12 justify-center"
                    onClick={() =>
                      signIn("Cal.com", {
                        callbackUrl: router.query.callbackUrl
                          ? `${WEBAPP_URL}/${router.query.callbackUrl}`
                          : `${WEBAPP_URL}/getting-started`,
                      })
                    }>
                    {t("login_instead")}
                  </Button>
                </div>
              </form>
            </FormProvider>
          </div>
        </div>
      </div>
    </LicenseRequired>
  );
}

export const getServerSideProps = async (ctx: GetServerSidePropsContext) => {
  const ssr = await ssrInit(ctx);
  const token = asStringOrNull(ctx.query.token);

  const props = {
    isGoogleLoginEnabled: IS_GOOGLE_LOGIN_ENABLED,
    isSAMLLoginEnabled,
    trpcState: ssr.dehydrate(),
    prepopulateFormValues: undefined,
  };

  // no token given, treat as a normal signup without verification token
  if (!token) {
    return {
      props: JSON.parse(JSON.stringify(props)),
    };
  }

  const verificationToken = await prisma.verificationToken.findUnique({
    where: {
      token,
    },
  });

  if (!verificationToken || verificationToken.expires < new Date()) {
    return {
      notFound: true,
    };
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      AND: [
        {
          email: verificationToken?.identifier,
        },
        {
          emailVerified: {
            not: null,
          },
        },
      ],
    },
  });

  if (existingUser) {
    return {
      redirect: {
        permanent: false,
        destination: "/auth/login?callbackUrl=" + `${WEBAPP_URL}/${ctx.query.callbackUrl}`,
      },
    };
  }

  return {
    props: {
      ...props,
      prepopulateFormValues: {
        email: verificationToken.identifier,
      },
    },
  };
};
