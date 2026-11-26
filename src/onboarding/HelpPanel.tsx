import {useOnboarding} from "./OnboardingContext";
import {TutorialEntryModal} from "./TutorialEntryModal";

export const HelpPanel = () => {
    const {helpOpen, closeHelp, startTour, navigateTo} = useOnboarding();
    if (!helpOpen) return null;

    return <TutorialEntryModal onStart={startTour} onOpenWiki={() => { closeHelp(); navigateTo("guide"); }} onClose={closeHelp} />;
};
