import React from 'react';
import { Shield, X, CheckCircle, AlertTriangle, FileText, Lock } from 'lucide-react';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
  showAcceptButton?: boolean;
}

export const TermsModal: React.FC<TermsModalProps> = ({
  isOpen,
  onClose,
  onAccept,
  showAcceptButton = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <Shield size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 leading-tight">
                EChat Terms & Conditions
              </h2>
              <p className="text-xs text-slate-500">
                Official Platform Safeguards & Community Guidelines (Updated 2026)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Terms Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-600 leading-relaxed">
          <div className="p-3.5 bg-blue-50 border border-blue-200/80 rounded-2xl flex items-start gap-3 text-blue-900">
            <AlertTriangle size={18} className="text-blue-600 shrink-0 mt-0.5" />
            <p className="text-xs font-medium">
              Please read these terms carefully before registering or using EChat. By creating an account or accessing the platform, you agree to be legally bound by these terms.
            </p>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">1</span>
              Strict Anti-Impersonation Policy
            </h3>
            <p>
              Users are explicitly and unconditionally prohibited from claiming to be, impersonating, or mimicking the <strong>EChat Developer, Super Admin, Founder (eldermoses89@gmail.com)</strong>, or any official EChat employee, agent, or moderator.
            </p>
            <p>
              The use of usernames, handles, biographies, or profile photos containing reserved designations such as "EChat Official", "Developer", "Admin", "Super Admin", or "Verified Staff" is forbidden and subject to instant, irreversible account termination.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">2</span>
              Intellectual Property & Anti-Cloning Safeguards
            </h3>
            <p>
              All software, source code, visual branding, real-time socket communication architectures, user interface components, and proprietary algorithms of the EChat application are the intellectual property of the Lead Developer.
            </p>
            <p>
              You agree not to reverse-engineer, decompile, disassemble, clone, replicate, frame, scrap, distribute, or create derivative works based upon the EChat platform or its underlying infrastructure.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">3</span>
              Age Verification & Safety (13+ Requirement)
            </h3>
            <p>
              You must be at least 13 years of age to register or use EChat. By submitting your Date of Birth, you certify under penalty of account forfeiture that the date provided is truthful and accurate. Accounts found to belong to individuals under the age of 13 will be deleted immediately.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">4</span>
              Zero-Tolerance Anti-Spam & Community Standards
            </h3>
            <p>
              Users must conduct themselves respectfully. The following activities result in immediate account suspension:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-500">
              <li>Sending unsolicited commercial spam, pyramid schemes, or bulk messaging.</li>
              <li>Harassment, hate speech, defamation, cyberbullying, or extortion.</li>
              <li>Distributing malicious URLs, phishing attempts, or unauthorized spyware.</li>
              <li>Attempting to manipulate platform metrics, followers, or artificial engagement.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">5</span>
              Account Verification & Live Broadcasts
            </h3>
            <p>
              Blue verification badges are non-transferable and issued exclusively at the sole discretion of the Lead Developer via the Master Console. Users cannot self-verify or purchase verification badges.
            </p>
            <p>
              Live Video Streaming ("Go Live") is a gated privilege requiring at least 60 active days on EChat to maintain broadcast quality and trust standards. The Lead Developer reserves unrestricted live broadcasting authority.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">6</span>
              Account Suspension & Legal Remedies
            </h3>
            <p>
              EChat administrators reserve the unilateral right to suspend, terminate, or restrict access to any account that breaches these terms without prior notice. Civil and legal action may be pursued in cases of trademark infringement or unlawful cloning.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400">
            EChat Legal Governance • All rights reserved
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition cursor-pointer"
            >
              Close
            </button>
            {showAcceptButton && (
              <button
                onClick={() => {
                  onAccept?.();
                  onClose();
                }}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle size={14} />
                I Agree & Accept
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
