// 测试入口：导出被测模块
export { renderSection } from "../src/render";
export { getSourceIndex, scanBlocks, SourceIndex } from "../src/core/source-index";
export { HeaderNumberer, parseHeaderTemplate, decimalToZh, decimalToRoman, decimalToAlpha } from "../src/core/header-num";
export { normalizeSubSup } from "../src/core/normalize";
export { Query, DEFAULT_SETTINGS } from "../src/core/context";
export { toTyporaDom, removeUnpublished } from "../src/preview/typora-dom";
export { appUrlsToRelative } from "../src/preview/typora-dom";
export { tabInfo } from "../src/features/structure";

export { INSERT_SYNTAX, insertSyntax } from "../src/editor/commands";
export { navigationItems } from "../src/navigation";
export { taskPercentFromSource } from "../src/features/inline-extras";
export { sourceImages, imageReferenceDefinitions } from "../src/core/image-source";
export { EditorState } from "@codemirror/state";
export { editorInfoField, editorLivePreviewField } from "obsidian";
export { blockPreviewPlans, blockPreviewExtension } from "../src/editor/block-preview";
export { livePreviewExtension } from "../src/editor/live-preview";
export { Component } from "obsidian";
export { removeRenderingMarker } from "../src/preview/typora-dom";
export { resolveVaultLink, rewriteExportLinks, preservePreviewLinks, previewLinkHref } from "../src/preview/links";

export { documentLibraryItems } from "../src/core/doc-library";

export { tableGrid, processTableTools } from "../src/features/table-tools";

export { processContentViewers, openContentViewer } from "../src/features/content-viewer";
export { contentKind } from "../src/features/content-viewer";

export { sourceContentItems } from "../src/core/content-index";

export { openSourceContentViewer } from "../src/features/source-content-viewer";
export { MarkdownRenderer } from "obsidian";

export { decodeUrlPart, encodeResourcePath, resourceQuery } from "../src/core/url";

export { roamingLines, roamingStep, roamingTarget } from "../src/paragraph-roaming";

export { readingPercent, ReadingProgress } from "../src/reading-progress";

export { QuietView } from "../src/quiet-view";

export { hasDirectStrike, unpublishedMatcher } from "../src/core/unpublished";
export { processToc, headingPlain } from "../src/features/toc";
export { waitForDiagrams, sourceDiagramCount } from "../src/preview/diagram-ready";
export { LineHistory, navigateViewLine, registerNavigationHistory } from "../src/navigation-history";
export { processUnpublished } from "../src/features/structure";
export { readingSignature, resumeLine, ResumeReading } from "../src/resume-reading";
export { slideGroups } from "../src/core/slide-groups";
export { NativeSlides } from "../src/native-slides";
export { slideFootnoteSeed, indexSlideFootnotes } from "../src/core/slide-footnotes";
export { sourceTasks } from "../src/core/task-source";
export { ReadingTools } from "../src/reading-tools";
export { resolveNavigationItem, NavigationModal } from "../src/navigation";
export { rewriteDocumentLibrary } from "../src/core/doc-library";
export { rewriteLibraryLinks } from "../src/preview/links";
export { ContentZoom } from "../src/core/content-zoom";
export { restoreImages } from "../src/preview/image-restore";
export { sourceLinks, linkMapGroups } from "../src/core/link-map";
export { hasSourceAnchor, auditVaultLinks } from "../src/core/link-audit";
export { duplicateAnchorWarnings } from "../src/core/link-audit";
export { quoteSourceTitles } from "../src/core/quote-source";

export { vlookAnchor } from '../src/core/anchor';
export { processResourceStatus } from '../src/features/resource-status';
export { renderedResourceFailures } from '../src/features/resource-status';
export { ResourceFailureHistory } from '../src/core/resource-history';
export { equationSourceLine } from '../src/core/math-anchor';
export { waitForMath } from '../src/preview/math-ready';
export { remoteAnchorCheckUrl } from '../src/core/remote-anchor';
export { RemoteAnchorModal } from '../src/link-map';
export { isVideoEmbed } from '../src/core/video-embed';
export { MediaHandoff, pauseContainedMedia } from '../src/core/media-handoff';
export { moveContent, borrowContent } from '../src/core/content-move';
export { captionTargets } from '../src/core/caption-targets';

export { selectedContentItem } from '../src/core/content-selection';

export { renderReadySection } from '../src/features/ready-section';
export {processCodeBlocks} from '../src/features/code-block';
export {bindCodeLine} from '../src/features/code-line';
export {renderMathFence} from '../src/features/math-fence';
export {sourceMathFenceCount} from '../src/preview/math-ready';
export {collectMathStyles} from '../src/preview/math-styles';
export {processExternalReferences} from '../src/features/external-reference';
export {vlookWordCount,readingDuration,readingText} from '../src/core/reading-time';
export {processMermaid} from '../src/features/mermaid';

export {restoreExportTaskStates} from '../src/preview/task-state';

export {processLinks} from '../src/features/link';

export {copyText} from '../src/core/dom';

export { openPhoneticLookup } from "../src/features/sup-sub-magic";
export { wrapTextSpans } from "../src/core/dom";
export { buildProgress } from "../src/features/inline-extras";

export { applyColorScheme } from "../src/features/image";

export { installExportGifControls } from "../src/preview/gif-control";
export { processMedia } from "../src/features/media";

export { enhanceExportMiniAudio } from "../src/preview/mini-audio-access";

export { processImages } from "../src/features/image";

export { DocumentAssets } from "../src/core/document-assets";

export { readCssVar } from "../src/core/context";

export { EditorThemeRefresh, editorThemeRevision, editorThemeRefreshEffect } from "../src/editor/theme-refresh";

export { editorThemeConfigEffect, editorThemeConfigField } from "../src/editor/theme-refresh";

export { navigationForView } from "../src/navigation";

export { buildVlookHtml } from "../src/preview/document";

export { normalizeVlookQuery } from "../src/core/query-source";

export { DocumentLibraryModal } from "../src/navigation";

export { VlookPreviewView } from "../src/preview/view";

export { renderedSourceImages } from "../src/core/rendered-image-source";
export { htmlMediaSources } from "../src/core/html-media";
export { mediaSources } from "../src/core/media-source";
export { figureSources } from "../src/core/figure-source";

export { resolveStyleName } from "../src/core/themes";
export { ThemeSwitcher } from "../src/theme-switcher";

export {Menu} from "obsidian";

export { renderZenUmlFallback } from "../src/features/zenuml-fallback";
export {watchFootnoteDiagrams} from '../src/features/footnote-diagrams';

export {compactPath,typographyCss,stripRemoteFonts} from '../src/core/page-appearance';

export {confirmExportPath} from '../src/preview/export';

export {createHeaderToolbar} from '../src/core/header-toolbar';
export { snapshotPrintDocument, appUrlsToFileUrls } from "../src/preview/pdf";
export { restoreSpacedLinks } from "../src/core/spaced-links";
export { insertTyporaBlankParagraphs } from "../src/core/fenced-source";
export { resolveBrokenEmbeds } from "../src/features/image";
export { parseFrontmatterYaml, quoteMarkdownLinkValues } from "../src/core/frontmatter";
export { repairDuplicateMathLabels } from "../src/features/math-labels";
export { repairNestedMath } from "../src/features/math-nested";
export { keepReadingPosition } from "../src/core/reading-position";
export { embeddedThemesHtml, installExportThemeSwitcher } from "../src/preview/theme-export";
export { TFolder, FuzzySuggestModal } from "obsidian";
export { prepareHtmlDocument } from "../src/preview/html-file-view";
export { fileIconCss, FILE_KINDS } from "../src/file-type-icons";
export { parseGrayDays, grayModeActive } from "../src/core/gray-mode";
export { welcomeMode, sanitizeWelcome } from "../src/core/welcome";
export { Dropdown } from "../src/core/dropdown";
export { setZenUmlSource, setZenUmlEnabled } from "../src/core/zenuml-loader";
export {auditLocalResources} from '../src/core/link-audit';
export {moveTable,tableAt} from '../src/core/table-move';
export {reorderTable} from '../src/core/table-move';
export { noticeKind } from "../src/notify";
export { ThemeStore, parseThemeHeader, themeParts } from "../src/core/theme-store";
export { THEMES, themeLabel, setThemes, isRemoteTheme } from "../src/core/themes";
