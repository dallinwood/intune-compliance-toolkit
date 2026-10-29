# Product grouping

The Products tab groups capabilities by **workload**, not by which subscription
first included them. The primary source is Microsoft's
[Modern Work Plan Comparison – Enterprise](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/bade/documents/products-and-services/en-us/education/Modern-Work-Plan-Comparison-Enterprise.pdf),
reviewed on 29 October 2026.

**Enterprise Mobility + Security is a subscription column in that document,
not the product category for Entra ID.** Office 365 and Microsoft 365 are also
subscription columns. Those headings must not become catch-all buckets for
unrelated security, identity, communications, and productivity products.

## Rules

- Use the comparison's workload headings for products it covers. Related
  standalone editions, add-ons and capacity belong beside their base product,
  not in separate "Extra Capacity", "Suite Value", or "Companion Products"
  groups.
- Products outside the comparison remain visible. Use a matching workload
  where applicable, or an official Microsoft documentation product family.
  A supplementary family is not a claim that the PDF includes that product.
- Keep each product in one primary group. Categories are navigational labels,
  not licence grants or dependencies. Licensing bundles belong in licence
  `includes`, and technical dependencies in product `requires`.
- A root product owns its category; its child features inherit that group.
  Do not change a real product's `parent` just to put it in a different section
  of the comparison. A product can span several of the PDF's feature sections.
- Use one spelling and capitalization for each group. A category change must
  include a source and update the grouping regression tests.

## Workloads from the comparison

| Group | PDF location and examples |
|---|---|
| Copilot | Page 1; baseline and premium Copilot experiences, Security Copilot. |
| Microsoft 365 apps | Page 2; desktop/mobile/web apps, Loop, Clipchamp, Visio for the web. |
| Email, calendar, and scheduling | Page 3; Exchange, archiving, Bookings. |
| Meetings, calling, and chat | Page 3, with Teams add-ons on page 12; Teams, Phone, Premium, calling and conferencing. |
| Intranet and storage | Page 3; SharePoint and OneDrive. SAM, storage and migration add-ons from page 12 stay beside SharePoint rather than becoming another conflicting storage group. |
| Content services | Page 4; Search, Forms, Lists, Graph content connectors. Document processing remains with content services. |
| Places | Page 4; Microsoft Places. |
| Analytics | Page 4; Adoption Score, Secure Score, Compliance Manager, Power BI. Related assessments and premium editions stay here. |
| Project and task management | Page 4; Planner, To Do, related Project and diagramming products. |
| Microsoft Viva | Page 12's family heading unifies Viva Learning, Insights, Engage and Connections from pages 4–5 with standalone Viva apps and add-ons. Basic and premium editions are not split between "Office 365" and "Employee experience". |
| Automation, app building, and chatbots | Page 5; Power Apps, Power Automate, Dataverse and Copilot Studio. Related Power Platform products and capacity stay here; Power BI follows Analytics instead. |
| Endpoint and app management | Page 5; Intune, Autopilot and endpoint management. Configuration Manager, standalone Intune modules and Tunnel stay together. |
| Threat protection | Page 6; Defender for Endpoint, Identity and Office 365, antivirus, firewall, Credential Guard and BitLocker. Related Defender vulnerability management and security services stay here. |
| Cloud access security broker | Page 6; Defender for Cloud Apps, app governance and Office 365 Cloud App Security. |
| Data lifecycle management | Page 6; retention policies, labels and records. |
| Identity and access management | Page 7; all Entra products, Governance and access capabilities, including independent Entra add-ons. No parallel "Microsoft Entra", "Identity" or EMS bucket. |
| Data loss prevention (DLP) | Page 7; DLP for content, Teams and endpoints, including related adaptive controls. |
| eDiscovery and auditing | Page 7; search, eDiscovery, audit levels and audit-retention add-ons. |
| Information protection | Page 8; rights management, labels, classifiers, encryption and Customer Key. |
| Insider risk management | Page 8; insider risk, communication compliance, information barriers and related privileged-access/lockbox controls. |
| Windows | Page 9; Windows capabilities, Azure Virtual Desktop, Windows 365, Universal Print and Autopatch. Other Windows editions and capacity stay together. |

This is a product navigation taxonomy, not an assertion that every supplementary
product appears as a row in the comparison. For example, putting the paid Power BI
edition in Analytics does not imply it is included in Microsoft 365.

## Supplementary official product families

These are only used where the existing catalog extends beyond the workload
comparison, or where a product spans several workload sections.

| Family | Official source and scope |
|---|---|
| Microsoft Agent 365 | [Agent 365 overview](https://learn.microsoft.com/en-us/microsoft-agent-365/overview). One product with observability, governance and security capabilities; these are three PDF feature sections, not three separate copies of the product. |
| Microsoft Azure | [Azure documentation](https://learn.microsoft.com/en-us/azure/). Azure Backup, Bastion, Automation, Log Analytics, RBAC, Update Manager and Communication Services. Azure-branded services explicitly placed in comparison workloads follow those workloads instead (e.g. Azure Virtual Desktop under Windows, Azure RMS under Information protection). |
| Microsoft Purview | [Purview documentation](https://learn.microsoft.com/en-us/purview/). Catalog, Data Map, data estate insights and data policy beyond the comparison's Microsoft 365 compliance workloads. DLP, audit, retention and information protection use their specific PDF workload instead. |
| Microsoft Priva | [Priva overview](https://learn.microsoft.com/en-us/privacy/priva/priva-overview). Privacy Risk Management. |
| Microsoft Dynamics 365 | [Dynamics 365 documentation](https://learn.microsoft.com/en-us/dynamics365/). Customer Voice and Digital Contact Centre. |
| Microsoft 365 | [Microsoft 365 documentation](https://learn.microsoft.com/en-us/microsoft-365/). Cross-service programmes, administration, server rights and services without a single comparison workload (Developer Program, Lighthouse, FastTrack, Industry Clouds, Workplace Discount Program, Office Servers, Productivity Server CAL and general alert policies). Not a substitute for the more specific workloads above. |
| Microsoft Support | [Microsoft Support](https://support.microsoft.com/en-us/). ProDirect support offers and Unified Support, separate from software workloads. |
| LinkedIn Learning | [LinkedIn Learning documentation](https://learn.microsoft.com/en-us/linkedin/learning/). Not misrepresented as a built-in Viva entitlement merely because it can integrate with Viva Learning. |

[Power Platform documentation](https://learn.microsoft.com/en-us/power-platform/)
and [Viva documentation](https://learn.microsoft.com/en-us/viva/) also establish
the app families used to keep related standalone and base capabilities together.

## Review coverage and validation

All 431 product files were reviewed for grouping: 245 root assignments and 186
child features inheriting their root's group. The result uses 29 workload/family
groups. The review changed category metadata only; it did not alter product ids,
parents, plans, licence eligibility, or entitlements.

The data checks in [test_product_categories.py](../tests/test_product_categories.py)
prevent reintroducing undocumented category buckets, split Entra/Intune/Copilot/
Viva families, casing duplicates, and ungrouped or contradictory child metadata.
The Products-tab browser tests use the published real catalog to verify that
the identity group contains Entra ID and its separately available products.
