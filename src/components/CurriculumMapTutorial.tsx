import {useLocale} from "../i18n/LocaleContext";
import {TutorialEntryModal} from "../onboarding/TutorialEntryModal";

interface Props {
  onClose: () => void;
  onStart: () => void;
  onOpenWiki: () => void;
}

export function CurriculumMapTutorial({onClose, onStart, onOpenWiki}: Props) {
  const {locale} = useLocale();
  const zh = locale === "zh";
  return (
    <TutorialEntryModal
      title={zh ? "培养方案导图" : "Curriculum map"}
      description={zh ? "选择高亮导图控制项的交互引导，或直接查阅课程、课组和模块关系说明。" : "Follow the highlighted map controls, or read about course, group, and module relationships."}
      onStart={onStart}
      onOpenWiki={onOpenWiki}
      onClose={onClose}
    />
  );
}
