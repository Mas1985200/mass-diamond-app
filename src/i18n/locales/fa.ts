import type { TranslationSchema } from "../types";

export const fa: TranslationSchema = {
  auth: {
    brand: "Mass Diamond",

    loginSubtitle: "برای ادامه وارد حساب کاربری شوید",
    signupSubtitle: "حساب کاربری خود را ایجاد کنید",

    email: "ایمیل",
    password: "رمز عبور",
    confirmPassword: "تکرار رمز عبور",

    emailPlaceholder: "example@email.com",
    passwordPlaceholder: "••••••••",
    confirmPasswordPlaceholder: "••••••••",

    login: "ورود",
    signup: "ثبت‌نام",
    loading: "لطفاً صبر کنید...",

    continueWithGoogle: "ادامه با Google",
    orDivider: "یا با ایمیل",

    signupSuccess:
      "حساب کاربری با موفقیت ساخته شد. لطفاً ایمیلتان را برای تأیید بررسی کنید.",

    invalidCredentials: "ایمیل یا رمز عبور اشتباه است.",

    emailNotConfirmed:
      "ایمیل شما هنوز تأیید نشده است. لطفاً ایمیلتان را برای تأیید بررسی کنید.",

    emailAlreadyRegistered: "این ایمیل قبلاً ثبت‌نام کرده است.",

    passwordTooShort: "رمز عبور باید حداقل ۶ کاراکتر باشد.",

    passwordMismatch: "رمزهای عبور یکسان نیستند.",

    invalidEmail: "لطفاً یک ایمیل معتبر وارد کنید.",

    rateLimit:
      "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.",

    networkError:
      "اتصال به سرور برقرار نشد. لطفاً اتصال اینترنت خود را بررسی کنید.",

    providerDisabled: "ورود با Google هنوز فعال نشده است.",

    genericError:
      "خطایی در احراز هویت رخ داد. لطفاً دوباره تلاش کنید.",

    switchToSignup: "حساب ندارید؟ ثبت‌نام کنید",
    switchToLogin: "قبلاً ثبت‌نام کرده‌اید؟ وارد شوید",
  },
};
