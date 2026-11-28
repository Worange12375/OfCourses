import {useOnboarding} from "./OnboardingContext";
import {TutorialEntryModal} from "./TutorialEntryModal";
import {useLocale} from "../i18n/LocaleContext";
import type {NavPage} from "../components/Navbar";

export const HelpPanel = ({currentPage}: {currentPage: NavPage}) => {
    const {helpOpen, closeHelp, startTour, navigateTo, pageHelp} = useOnboarding();
    const {locale} = useLocale();
    if (!helpOpen) return null;
    const contextualHelp = pageHelp[currentPage];

    return (
        <TutorialEntryModal
            title={contextualHelp?.title[locale]}
            description={contextualHelp?.description[locale]}
            pageContext={!!contextualHelp}
            onStart={() => startTour(contextualHelp?.steps)}
            onOpenWiki={() => {
                closeHelp();
                navigateTo("guide", contextualHelp?.wikiSection ?? "getting-started");
            }}
            globalActions={contextualHelp ? {
                onStart: () => startTour(),
                onOpenWiki: () => {
                    closeHelp();
                    navigateTo("guide", "getting-started");
                },
            } : undefined}
            onClose={closeHelp}
        />
    );
};
