import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROLE_NAVIGATION } from '../src/utils/constants.js';

test('staff front desk navigation matches admin work mode titles and category', () => {
  // RECEPTIONIST must match Admin Front Desk & Billing
  const receptionNav = ROLE_NAVIGATION.RECEPTIONIST;
  assert.ok(receptionNav, 'RECEPTIONIST navigation exists');
  const receptionDesk = receptionNav.find((item) => item.path === '/reception/registered-patients');
  assert.ok(receptionDesk, 'Reception Desk path is /reception/registered-patients');
  assert.equal(receptionDesk.title, 'Reception Desk');
  assert.equal(receptionDesk.category, 'Front Desk & Billing');

  const followUpVisits = receptionNav.find((item) => item.path === '/reception/registered-patients?tab=FOLLOW_UPS');
  assert.ok(followUpVisits, 'Follow-Up Visits exists in RECEPTIONIST');
  assert.equal(followUpVisits.title, 'Follow-Up Visits');
  assert.equal(followUpVisits.category, 'Front Desk & Billing');

  // OPD_STAFF must match Front Desk & Billing
  const opdNav = ROLE_NAVIGATION.OPD_STAFF;
  assert.ok(opdNav, 'OPD_STAFF navigation exists');
  const opdDesk = opdNav.find((item) => item.path === '/reception/registered-patients');
  assert.ok(opdDesk);
  assert.equal(opdDesk.title, 'Reception Desk');
  assert.equal(opdDesk.category, 'Front Desk & Billing');

  // CASHIER and BILLING_STAFF must use Front Desk & Billing
  const cashierNav = ROLE_NAVIGATION.CASHIER;
  assert.ok(cashierNav);
  const billingDesk = cashierNav.find((item) => item.path === '/billing/dashboard');
  assert.ok(billingDesk);
  assert.equal(billingDesk.title, 'Central Billing Desk');
  assert.equal(billingDesk.category, 'Front Desk & Billing');

  const receipts = cashierNav.find((item) => item.path === '/billing/dashboard?tab=RECEIPTS');
  assert.ok(receipts);
  assert.equal(receipts.title, 'Receipts & Payments');
  assert.equal(receipts.category, 'Front Desk & Billing');
});

test('Sidebar source verifies CANONICAL_CATEGORY_ORDER and CANONICAL_ITEM_ORDER', async () => {
  const sidebarSrc = await readFile(new URL('../src/components/layout/Sidebar.jsx', import.meta.url), 'utf8');

  // Verify CANONICAL_CATEGORY_ORDER
  assert.ok(sidebarSrc.includes('CANONICAL_CATEGORY_ORDER'), 'Sidebar defines CANONICAL_CATEGORY_ORDER');
  assert.ok(sidebarSrc.includes("'Clinical Workstation'"));
  assert.ok(sidebarSrc.includes("'Front Desk & Billing'"));
  assert.ok(sidebarSrc.includes("'Inpatient & Ward'"));
  assert.ok(sidebarSrc.includes("'Support & Diagnostics'"));

  // Verify CANONICAL_ITEM_ORDER
  assert.ok(sidebarSrc.includes('CANONICAL_ITEM_ORDER'), 'Sidebar defines CANONICAL_ITEM_ORDER');
  assert.ok(sidebarSrc.includes("'/reception/registered-patients'"));
  assert.ok(sidebarSrc.includes("'/billing/dashboard'"));

  // Verify groupedCategories sorts using both canonical orders
  assert.ok(sidebarSrc.includes('CANONICAL_CATEGORY_ORDER.indexOf'));
  assert.ok(sidebarSrc.includes('CANONICAL_ITEM_ORDER.indexOf'));

  // Verify category order hierarchy
  const catOrderSection = sidebarSrc.slice(
    sidebarSrc.indexOf('CANONICAL_CATEGORY_ORDER = ['),
    sidebarSrc.indexOf('];', sidebarSrc.indexOf('CANONICAL_CATEGORY_ORDER = [')),
  );
  const clinicalIdx = catOrderSection.indexOf("'Clinical Workstation'");
  const frontDeskIdx = catOrderSection.indexOf("'Front Desk & Billing'");
  const ipdIdx = catOrderSection.indexOf("'Inpatient & Ward'");
  const supportIdx = catOrderSection.indexOf("'Support & Diagnostics'");
  const trackingIdx = catOrderSection.indexOf("'Live Tracking & Audit'");
  const emergencyIdx = catOrderSection.indexOf("'Emergency Services'");

  assert.ok(clinicalIdx < frontDeskIdx, 'Clinical precedes Front Desk');
  assert.ok(frontDeskIdx < ipdIdx, 'Front Desk precedes Inpatient');
  assert.ok(ipdIdx < supportIdx, 'Inpatient precedes Diagnostics');
  assert.ok(supportIdx < trackingIdx, 'Diagnostics precedes Live Tracking');
  assert.ok(trackingIdx < emergencyIdx, 'Live Tracking precedes Emergency');
});
