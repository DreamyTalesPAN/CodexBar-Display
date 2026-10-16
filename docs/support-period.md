# Support Period And Update Commitment (Draft)

> **Draft for #538.** The support period is a business commitment, decided
> by DreamyTales on 2026-10-16. It appears unchanged in the EU Declaration of
> Conformity and on the product page.
>
> **Support period: security updates for at least 5 years from the date the
> VibeTV was sold.**

## What the commitment covers

For the support period above, DreamyTales provides security updates for:

- the VibeTV firmware (ESP8266, the published release firmware),
- the VibeTV Mac App and the Windows app that install those updates,
- the Companion service those apps run on the customer's computer.

A security update is released when a vulnerability that affects VibeTV
becomes known, whether it is reported to us (see
[Reporting a security vulnerability](vulnerability-reporting.md)) or found by
the per-change dependency check in
[`sbom-cve-report.yml`](../.github/workflows/sbom-cve-report.yml).

## How updates reach the customer

- Firmware updates are installed only over the USB cable, started by the
  customer in the Mac App or the Windows app. The VibeTV has no network
  update route.
- The apps tell the customer when a newer version is available.
- Every release passes the hosted release gates described in
  [Hosted VibeTV gates](vibetv-hosted-gates.md) before it is published.

## End of support

After the support period, the VibeTV keeps working with the last released
firmware and apps. DreamyTales states the end of support on the product page
in advance.
