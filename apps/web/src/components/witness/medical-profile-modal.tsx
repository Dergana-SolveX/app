import React, { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Heart, ShieldCheck, X, Check, Copy, Trash2 } from "lucide-react";
import { trpc } from "@/utils/trpc";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  currentShortCode: string | null;
  onProfileSaved: (shortCode: string | null) => void;
  lang?: "fr" | "ar";
};

export function MedicalProfileModal({
  isOpen,
  onClose,
  currentShortCode,
  onProfileSaved,
  lang = "fr",
}: Props) {
  const isAr = lang === "ar";
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState<"male" | "female">("male");
  const [phone, setPhone] = useState("");
  const [bloodType, setBloodType] = useState<string>("O+");
  const [chronicInput, setChronicInput] = useState("");
  const [consent, setConsent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(currentShortCode);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setGeneratedCode(currentShortCode);
  }, [currentShortCode]);

  const registerMutation = useMutation(
    trpc.profiles.register.mutationOptions({
      onSuccess: (res) => {
        setGeneratedCode(res.shortCode);
        onProfileSaved(res.shortCode);
        setErrorMsg(null);
      },
      onError: (err) => {
        setErrorMsg(err.message || (isAr ? "خطأ أثناء التسجيل" : "Erreur lors de l'enregistrement"));
      },
    }),
  );

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!consent) {
      setErrorMsg(
        isAr
          ? "الموافقة الصريحة وفقاً للقانون 18-07 إلزامية."
          : "Le consentement explicite Loi 18-07 est obligatoire.",
      );
      return;
    }

    if (!fullName.trim() || !phone.trim()) {
      setErrorMsg(
        isAr
          ? "يرجى ملء الاسم ورقم الهاتف."
          : "Veuillez renseigner votre nom et votre numéro de téléphone.",
      );
      return;
    }

    const chronicConditions = chronicInput
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    registerMutation.mutate({
      fullName: fullName.trim(),
      sex,
      phone: phone.trim(),
      bloodType: (bloodType || undefined) as any,
      chronicConditions,
      consent: true,
    });
  };

  const handleCopyCode = () => {
    if (generatedCode && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClearProfile = () => {
    setGeneratedCode(null);
    onProfileSaved(null);
    setFullName("");
    setPhone("");
    setChronicInput("");
    setConsent(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
      dir={isAr ? "rtl" : "ltr"}
      className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm max-h-[90%] overflow-y-auto p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-500 fill-red-500/20" />
            <h2 id="profile-modal-title" className="font-semibold text-lg">
              {isAr ? "الملف الطبي للطوارئ" : "Profil d'urgence"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            aria-label={isAr ? "إغلاق" : "Fermer"}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Existing registered code view */}
        {generatedCode ? (
          <div className="space-y-4">
            <div className="bg-emerald-950/40 border border-emerald-600/30 rounded-xl p-4 text-center">
              <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-xs text-emerald-300 font-medium uppercase tracking-wider mb-1">
                {isAr ? "رمز الطوارئ الخاص بك (UID)" : "Votre code d'urgence (UID)"}
              </p>
              <div
                data-testid="profile-short-code-display"
                className="text-2xl font-mono font-bold tracking-widest text-emerald-200 py-1"
              >
                {generatedCode}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                {isAr
                  ? "يتم إرفاق هذا الرمز تلقائيًا بإنذاراتك لإخطار الإسعاف بتاريخك الطبي."
                  : "Ce code est rattaché automatiquement à vos signalements pour alerter les secours de vos antécédents médicaux."}
              </p>

              <button
                type="button"
                onClick={handleCopyCode}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 text-xs font-medium transition"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? (isAr ? "تم النسخ !" : "Copié !") : isAr ? "نسخ الرمز" : "Copier le code"}
              </button>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleClearProfile}
                className="flex-1 py-2 px-3 rounded-xl border border-red-900/50 bg-red-950/20 text-red-300 text-xs hover:bg-red-900/40 flex items-center justify-center gap-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isAr ? "حذف من هذا الجهاز" : "Supprimer de cet appareil"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium transition"
              >
                {isAr ? "إنهاء" : "Terminer"}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="bg-slate-800/60 rounded-lg p-2.5 text-[11px] text-slate-300 border border-slate-700/60">
              <span className="font-semibold text-amber-400">
                {isAr ? "اختياري — لا يلزم وجود حساب." : "Optionnel — Aucun compte requis."}
              </span>{" "}
              {isAr
                ? "يتيح هذا الملف لفرق النجدة الاطلاع على معلوماتك الحيوية فور تلقي البلاغ."
                : "Ce profil permet aux secours régulateurs d'accéder à vos informations vitales dès la réception de l'alerte."}
            </div>

            {errorMsg && (
              <div className="bg-red-900/30 border border-red-500/40 text-red-300 text-xs rounded-lg p-2.5">
                {errorMsg}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {isAr ? "الاسم واللقب *" : "Nom & Prénom *"}
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={isAr ? "مثال: أمينة بن علي" : "Ex. Amina Benali"}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {isAr ? "الجنس *" : "Sexe *"}
                </label>
                <select
                  value={sex}
                  onChange={(e) => setSex(e.target.value as any)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  <option value="male">{isAr ? "ذكر" : "Homme"}</option>
                  <option value="female">{isAr ? "أنثى" : "Femme"}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {isAr ? "فصيلة الدم" : "Groupe sanguin"}
                </label>
                <select
                  value={bloodType}
                  onChange={(e) => setBloodType(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {isAr ? "رقم الهاتف *" : "Numéro de téléphone *"}
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={isAr ? "مثال: 0555123456" : "Ex. 0555 12 34 56"}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {isAr ? "الأمراض المزمنة (مفصولة بفواصل)" : "Maladies chroniques (séparées par virgule)"}
              </label>
              <input
                type="text"
                value={chronicInput}
                onChange={(e) => setChronicInput(e.target.value)}
                placeholder={isAr ? "مثال: سكري، ربو، ضغط الدم" : "Ex. diabète, asthme, hypertension"}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
              />
            </div>

            {/* Law 18-07 explicit consent */}
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-2.5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 bg-slate-800 text-red-500 focus:ring-0"
                />
                <span className="text-[10px] text-slate-300 leading-tight">
                  <strong className="text-white">
                    {isAr ? "الموافقة وفق القانون 18-07: " : "Consentement Loi 18-07 : "}
                  </strong>
                  {isAr
                    ? "أوافق على نقل هذه البيانات الطبية بصورة مشفرة واستخدامها حصريًا من قبل مصالح الإسعاف عند وقوع حادث."
                    : "J'accepte que ces données médicales soient transmises de façon chiffrée et utilisées exclusivement par les services de secours en cas d'accident."}
                </span>
              </label>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 px-3 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition"
              >
                {isAr ? "إلغاء" : "Annuler"}
              </button>
              <button
                type="submit"
                disabled={registerMutation.isPending || !consent}
                className="flex-1 py-2 px-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-red-600/30 transition"
              >
                {registerMutation.isPending
                  ? isAr
                    ? "جاري التسجيل..."
                    : "Enregistrement..."
                  : isAr
                    ? "الحصول على UID"
                    : "Obtenir mon UID"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
