import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Camera — UA Platform",
  robots: { index: false, follow: false },
};

export default function CamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="fixed inset-0 z-50 bg-black">{children}</div>;
}
