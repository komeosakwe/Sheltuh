import type { Metadata } from "next";
import Link from "next/link";
import AdminGate from "@/components/admin/AdminGate";
import ReportQueue from "@/components/admin/ReportQueue";

export const metadata: Metadata = { title: "Member reports — Sheltüh admin" };

export default function AdminReportsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <Link href="/admin" className="text-sm text-accent underline underline-offset-2">
        &larr; Admin
      </Link>
      <h1 className="display-lg">Member reports</h1>
      <AdminGate>
        <ReportQueue />
      </AdminGate>
    </div>
  );
}
