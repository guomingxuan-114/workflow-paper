import { ArrowUpRight, FilePlus2, FolderOpen, Import, Sparkles } from "lucide-react";
import { PRODUCT } from "../config/product";

interface WelcomeProps {
  onNew: () => void;
  onImportSample: () => void;
  onTemplates: () => void;
  onOpen: () => void;
}

export function Welcome({
  onNew,
  onImportSample,
  onTemplates,
  onOpen,
}: WelcomeProps) {
  return (
    <main className="welcome">
      <div className="welcome-ambient welcome-ambient--one" />
      <div className="welcome-ambient welcome-ambient--two" />
      <header className="welcome-header">
        <div className="brand">
          <span className="brand-mark">流</span>
          <span>{PRODUCT.name}</span>
        </div>
        <button className="button button--quiet" onClick={onOpen}>
          <FolderOpen size={16} />
          打开本地文件
        </button>
      </header>
      <section className="welcome-hero">
        <div className="eyebrow">LOCAL-FIRST WORKFLOW NOTES</div>
        <h1>
          把流程画下来，
          <br />
          也把结构留清楚。
        </h1>
        <p>
          用键盘整理语义，用鼠标安排空间。所有内容保留在本机，
          可直接保存为可迁移的工作流文档。
        </p>
      </section>
      <section className="welcome-actions" aria-label="开始方式">
        <button className="start-card start-card--primary" onClick={onNew}>
          <span className="start-icon">
            <FilePlus2 size={24} />
          </span>
          <span>
            <strong>新建空白</strong>
            <small>从空白画布开始梳理</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
        <button className="start-card" onClick={onImportSample}>
          <span className="start-icon">
            <Import size={24} />
          </span>
          <span>
            <strong>导入示例</strong>
            <small>读取结构化程序版本快照</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
        <button className="start-card" onClick={onTemplates}>
          <span className="start-icon">
            <Sparkles size={24} />
          </span>
          <span>
            <strong>查看模板</strong>
            <small>审批与故障响应流程</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
      </section>
      <footer className="welcome-footer">
        <span>离线优先</span>
        <span>键鼠双通道编辑</span>
        <span>语义与布局分离</span>
        <span>.{PRODUCT.fileExtension} 单文件容器</span>
      </footer>
    </main>
  );
}

